import BetterSqlite3 from 'better-sqlite3'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { platform } from 'node:os'
import { basename, join } from 'node:path'
import { inspect } from 'node:util'
import ora from 'ora'

import type {
  CodeBlock,
  ConversationData,
  ConversationItem,
  Message,
  RichTextBlockNode,
  RichTextContentNode,
  RichTextNode,
  RichTextRoot,
} from '../types.js'

// Comment out potentially incompatible function for now
/*
interface CodeBlock {
  [key: string]: unknown
  content?: string
  end?: number
  language?: string
  start?: number
  uri?: {
    [key: string]: unknown
    path: string
  }
}
interface DiffChange {
  modified: string[]
  original: {
    endLineNumberExclusive: number
    startLineNumber: number
  }
}
function processInlineDiffs(message: any): void {
  // ... implementation ...
}
*/

// --- Helper Functions for Rich Text Extraction --- 

/**
 * Recursively extracts text content from a ProseMirror-like node structure.
 */
function extractTextFromNodes(nodes: RichTextNode[] | undefined): string {
  if (!nodes) return ''
  let text = ''
  for (const node of nodes) {
    if (!node) continue;

    if (node.type === 'text') {
      // Cast to access text property
      text += (node as RichTextContentNode).text ?? ''
    } else if (['blockquote', 'heading', 'listItem', 'paragraph'].includes(node.type)) {
      // Cast to access content/children
      const blockNode = node as RichTextBlockNode;
      if (Array.isArray(blockNode.content)) {
        text += extractTextFromNodes(blockNode.content)
      }

      if (Array.isArray(blockNode.children)) {
        text += extractTextFromNodes(blockNode.children)
      }
    } else {
      // Handle other potential block types or recurse
      const blockNode = node as RichTextBlockNode; // Assume block-like for recursion
      if (Array.isArray(blockNode.content)) {
        text += extractTextFromNodes(blockNode.content)
      }

      if (Array.isArray(blockNode.children)) {
        text += extractTextFromNodes(blockNode.children)
      }
    }
  }

  return text
}

/**
 * Extracts code blocks from a ProseMirror-like node structure.
 */
function extractCodeBlocksFromNodes(nodes: RichTextNode[] | undefined): Partial<CodeBlock>[] {
  if (!nodes) return []
  const codeBlocks: Partial<CodeBlock>[] = []
  for (const node of nodes) {
    if (!node) continue;

    if (node.type === 'code') {
      // Cast to access content/attrs
      const codeBlockNode = node as RichTextBlockNode;
      let codeContent = '';
      if (Array.isArray(codeBlockNode.content)) {
        codeContent = extractTextFromNodes(codeBlockNode.content)
      }

      let language = 'plaintext';
      if (typeof codeBlockNode.attrs === 'object' && codeBlockNode.attrs !== null && typeof codeBlockNode.attrs.params === 'string') {
        language = codeBlockNode.attrs.params;
      }

      codeBlocks.push({
        code: codeContent,
        language,
      })
    } else if (['blockquote', 'listItem'].includes(node.type)) { // Recurse for block types that might contain nested code
      const blockNode = node as RichTextBlockNode;
      if (Array.isArray(blockNode.children)) {
        codeBlocks.push(...extractCodeBlocksFromNodes(blockNode.children))
      }
    } else if (Array.isArray((node as RichTextBlockNode).children)) { // General recursion for blocks with children
      codeBlocks.push(...extractCodeBlocksFromNodes((node as RichTextBlockNode).children))
    }
  }

  return codeBlocks
}

// --- Type guard for NEW raw ConversationData --- 
interface RawConversationData {
  composerId: string
  context?: unknown
  conversation: ConversationItem[] // Use new type
  createdAt: number
  name?: string
  text?: string
  unifiedMode?: string
}

function getCursorDbPath(): string {
  const os = platform()
  const home = process.env.HOME || process.env.USERPROFILE || ''

  switch (os) {
    case 'darwin': {
      // macOS
      return join(home, 'Library/Application Support/Cursor/User/globalStorage/state.vscdb')
    }

    case 'linux': {
      // Linux
      return join(home, '.config/Cursor/User/globalStorage/state.vscdb')
    }

    case 'win32': {
      // Windows
      return join(process.env.APPDATA || join(home, 'AppData/Roaming'), 'Cursor/User/globalStorage/state.vscdb')
    }

    default: {
      throw new Error(`Unsupported platform: ${os}`)
    }
  }
}

function getWorkspaceStoragePath(): string {
  const os = platform()
  const home = process.env.HOME || process.env.USERPROFILE || ''

  switch (os) {
    case 'darwin': {
      // macOS
      return join(home, 'Library/Application Support/Cursor/User/workspaceStorage')
    }

    case 'linux': {
      // Linux
      return join(home, '.config/Cursor/User/workspaceStorage')
    }

    case 'win32': {
      // Windows
      return join(process.env.APPDATA || join(home, 'AppData/Roaming'), 'Cursor/User/workspaceStorage')
    }

    default: {
      throw new Error(`Unsupported platform: ${os}`)
    }
  }
}

function decodeWorkspacePath(uri: string): string {
  try {
    const path = uri.replace(/^file:\/\//, '')
    return decodeURIComponent(path)
  } catch (error) {
    console.error('Failed to decode workspace path:', error)
    return uri
  }
}

function findWorkspaceInfo(composerId: string): { name?: string; path?: string } {
  const workspaceStoragePath = getWorkspaceStoragePath()
  if (!existsSync(workspaceStoragePath)) return {}

  const workspaces = readdirSync(workspaceStoragePath, { withFileTypes: true })

  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue

    const dbPath = join(workspaceStoragePath, workspace.name, 'state.vscdb')
    if (!existsSync(dbPath)) continue

    let db: BetterSqlite3.Database | null = null;
    try {
      db = new BetterSqlite3(dbPath, { fileMustExist: true, readonly: true })
      const result = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get() as
        | undefined
        | { value: string }

      if (result?.value) {
        const parsed = JSON.parse(result.value) as unknown
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'allComposers' in parsed &&
          Array.isArray(parsed.allComposers) &&
          parsed.allComposers.some(
            (c: unknown) => typeof c === 'object' && c !== null && 'composerId' in c && c.composerId === composerId,
          )
        ) {
          const workspaceJsonPath = join(workspaceStoragePath, workspace.name, 'workspace.json')
          if (existsSync(workspaceJsonPath)) {
            const workspaceData = JSON.parse(readFileSync(workspaceJsonPath, 'utf8'))
            if (workspaceData.folder) {
              const path = decodeWorkspacePath(workspaceData.folder)
              db.close() // Close DB before returning
              return {
                name: basename(path),
                path,
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error reading workspace DB ${dbPath}:`, error)
    } finally {
      db?.close()
    }
  }

  return {}
}

// --- Utility Functions --- 
// Ensure listWorkspaces is exported
/**
 * Lists all available workspaces.
 * @returns An array of workspace objects with name and path properties
 */
export function listWorkspaces(): Array<{ id: string; name: string; path: string; }> {
  const workspaceStoragePath = getWorkspaceStoragePath()
  if (!existsSync(workspaceStoragePath)) return []

  const workspaces = readdirSync(workspaceStoragePath, { withFileTypes: true })
  const result: Array<{ id: string; name: string; path: string; }> = []

  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue

    const workspaceJsonPath = join(workspaceStoragePath, workspace.name, 'workspace.json')
    if (!existsSync(workspaceJsonPath)) continue

    try {
      const workspaceData = JSON.parse(readFileSync(workspaceJsonPath, 'utf8'))
      if (workspaceData.folder) {
        const path = decodeWorkspacePath(workspaceData.folder)
        const name = basename(path)
        result.push({
          id: workspace.name,
          name,
          path,
        })
      }
    } catch (error) {
      console.error(`Error reading workspace ${workspace.name}:`, error)
    }
  }

  return result
}

/**
 * Finds workspace subdirectories matching the given name and extracts
 * composer IDs and the database path from their respective state.vscdb files.
 *
 * @param workspaceName The base name of the workspace directory to find.
 * @returns An object containing the set of composer IDs and the path to the specific workspace database, or null if not found.
 */
function getWorkspaceInfo(workspaceName: string): null | { composerIds: Set<string>; dbPath: string; rawConversationJson?: string } {
  const workspaceStoragePath = getWorkspaceStoragePath()
  if (!existsSync(workspaceStoragePath)) {
    console.warn(`Workspace storage path not found: ${workspaceStoragePath}`)
    return null; // Return null if we can't even read the directory
  }

  let foundWorkspace: null | { composerIds: Set<string>; dbPath: string; rawConversationJson?: string } = null;
  const spinner = ora(`Searching for workspace '${workspaceName}' metadata`).start()

  try {
    const workspaces = readdirSync(workspaceStoragePath, { withFileTypes: true })

    for (const workspace of workspaces) {
      if (!workspace.isDirectory()) continue

      const workspaceDirPath = join(workspaceStoragePath, workspace.name)
      const workspaceJsonPath = join(workspaceDirPath, 'workspace.json')
      const dbPath = join(workspaceDirPath, 'state.vscdb')

      // Check if workspace.json and state.vscdb exist
      if (!existsSync(workspaceJsonPath) || !existsSync(dbPath)) {
        continue
      }

      try {
        const workspaceData = JSON.parse(readFileSync(workspaceJsonPath, 'utf8')) as {
          folder?: string
          id?: string
          // Other potential properties
        }

        if (!workspaceData.folder) continue

        const decodedPath = decodeWorkspacePath(workspaceData.folder)
        const currentWorkspaceBaseName = basename(decodedPath)

        // Compare base names
        if (currentWorkspaceBaseName === workspaceName) {
          spinner.text = `Found matching workspace metadata for '${workspaceName}'. Reading database ${basename(dbPath)}...`
          // Found the matching workspace, now extract composer IDs from its DB
          let db: BetterSqlite3.Database | null = null;
          const composerIds = new Set<string>();
          let potentialRawJson: string | undefined; // Variable to store potential JSON
          try {
            db = new BetterSqlite3(dbPath, { fileMustExist: true, readonly: true })
            // Query for keys that store composer data.
            // This query assumes composer IDs are stored within a JSON value under the key 'composer.composerData' or related keys.
            const results = db
              .prepare("SELECT value FROM ItemTable WHERE key LIKE '%composer.composerData%' OR key LIKE '%workbench.editors.textResourceEditor%'") // Broaden search
              .all() as Array<{ value: string }>

            let foundIdsInThisDb = false;
            for (const row of results) {
              try {
                const data = JSON.parse(row.value) as unknown
                // Look for composer IDs in various possible structures
                if (typeof data === 'object' && data !== null) {
                  // Prioritize finding 'allComposers' structure first
                  if ('allComposers' in data && Array.isArray(data.allComposers)) {
                    for (const composer of data.allComposers) {
                      if (typeof composer === 'object' && composer !== null && 'composerId' in composer && typeof composer.composerId === 'string') {
                        composerIds.add(composer.composerId)
                        foundIdsInThisDb = true;
                      }
                    }
                    // Always set potentialRawJson if allComposers is present
                    potentialRawJson = row.value;
                  } else if ('composerId' in data && typeof data.composerId === 'string') {
                    // Handle case where composerId is directly in the parsed object
                    composerIds.add(data.composerId);
                    foundIdsInThisDb = true;
                    // Check if this simpler structure also contains the conversation array
                    if ('conversation' in data && Array.isArray(data.conversation)) {
                      potentialRawJson = row.value; // Store the raw JSON string
                      // console.log(`[Debug getWorkspaceInfo] Found potential conversation JSON in ItemTable row (direct composerId structure)`);
                    }
                  }
                  // Add more checks for different potential structures if needed (e.g., editor history)
                }
              } catch /* jsonError */ {
                // Ignore entries that are not valid JSON or don't match expected structures
                // console.warn(`Skipping non-JSON or unexpected structure in row for key in ${dbPath}:`, jsonError);
              }

              // If we found potential JSON, stop processing more rows for this DB
              if (potentialRawJson) break;
            }

            db.close() // Close DB after successful query

            if (foundIdsInThisDb) { // Use the flag set inside the loop
              spinner.succeed(`Found ${composerIds.size} potential composer IDs in workspace '${workspaceName}' database (${basename(dbPath)}). ${potentialRawJson ? 'Found potential conversation data directly.' : 'Direct conversation data not found in ItemTable.'}`)
              // Include the potentialRawJson in the return object
              foundWorkspace = { composerIds, dbPath, rawConversationJson: potentialRawJson };
              break; // Stop searching workspace directories once found
            } else {
              spinner.info(`Workspace '${workspaceName}' database (${basename(dbPath)}) found, but no composer IDs extracted.`)
            }

          } catch (dbError) {
            spinner.fail(`Error reading workspace DB ${dbPath}: ${dbError instanceof Error ? dbError.message : String(dbError)}`)
            db?.close() // Ensure DB is closed on error
          }
        }
      } catch /* jsonError */ {
        // Ignore errors reading or parsing workspace.json
        // spinner.warn(`Skipping workspace due to error reading/parsing ${workspaceJsonPath}: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`);
      }
    }
  } catch (readDirError) {
    spinner.fail(`Error reading workspace storage directory: ${readDirError instanceof Error ? readDirError.message : String(readDirError)}`)
    return null; // Return null if we can't even read the directory
  }

  if (!foundWorkspace && spinner.isSpinning) { // Check if still spinning (meaning not succeeded/failed/warned yet)
    spinner.warn(`Workspace '${workspaceName}' metadata not found or no composer IDs extracted from associated database(s).`)
  } else if (!foundWorkspace) {
    // If it wasn't spinning, a message was already shown (e.g., .info())
    // console.log(`Workspace '${workspaceName}' not found or no composer IDs extracted.`);
  }


  return foundWorkspace
}

// --- NEW HELPER: Process a single conversation entry --- 
function processConversationEntry(rawData: RawConversationData): ConversationData | null {
  console.log(`[Debug processConversationEntry] Processing raw data for composerId: ${rawData.composerId}`);
  console.log(`[Debug processConversationEntry] Raw parsed JSON:
${inspect(rawData, { colors: true, depth: 3 })}`); // Log raw structure

  const processedMessages: Message[] = []

  if (!Array.isArray(rawData.conversation) || rawData.conversation.length === 0) {
    console.log(`[Debug processConversationEntry] Skipping composerId ${rawData.composerId} due to empty or missing 'conversation' array.`);
    return null;
  }

  for (const item of rawData.conversation) {
    let role: 'assistant' | 'user' | null = null
    if (item.type === 1) {
      role = 'user'
    } else if (item.type === 2) {
      role = 'assistant'
    } else {
      continue // Skip unknown types
    }

    let extractedText = ''
    let extractedCodeBlocks: Partial<CodeBlock>[] = []
    let richTextData: null | RichTextRoot = null

    // 1. Try parsing richText
    if (typeof item.richText === 'string' && item.richText.trim().startsWith('{')) {
      try {
        richTextData = JSON.parse(item.richText) as RichTextRoot
        if (richTextData?.root?.children) {
          extractedText = extractTextFromNodes(richTextData.root.children)
          extractedCodeBlocks = extractCodeBlocksFromNodes(richTextData.root.children)
        }
      } catch {
        // Ignore parsing errors
      }
    }

    // 2. Handle direct text/codeblocks
    if (role === 'assistant') {
      if (!extractedText && item.text && item.text.trim().length > 0) {
        extractedText = item.text;
      }

      if (extractedCodeBlocks.length === 0 && Array.isArray(item.codeBlocks)) {
        extractedCodeBlocks = item.codeBlocks.map(cb => ({ code: cb?.code ?? '', language: cb?.language ?? 'plaintext' })).filter(cb => cb.code);
      }
    }

    if (role === 'user' && !extractedText && item.text && item.text.trim().length > 0) {
      extractedText = item.text.trim();
    }

    // 3. Construct Message
    if (extractedText.trim().length > 0 || extractedCodeBlocks.length > 0) {
      const finalCodeBlocks: CodeBlock[] = extractedCodeBlocks.map(cb => ({ code: cb.code ?? '', language: cb.language ?? 'plaintext' }));
      const message: Message = {
        codeBlocks: finalCodeBlocks,
        content: extractedText.trim(),
        metadata: { bubbleId: item.bubbleId, type: item.type, ...(item.timingInfo && { timingInfo: item.timingInfo }), ...(item.isThought && { isThought: item.isThought }) },
        role,
        text: extractedText.trim(),
        ...(item.timingInfo && { timingInfo: item.timingInfo }),
      };
      processedMessages.push(message);
    }
  }

  if (processedMessages.length === 0) {
    console.log(`[Debug processConversationEntry] No processable messages found for composerId ${rawData.composerId} after iterating through ${rawData.conversation.length} items. Raw data was logged above.`);
    return null; // Skip conversations with no processable messages
  }

  // Find workspace info (this is slightly redundant here, but adds path if found)
  const workspaceInfo = findWorkspaceInfo(rawData.composerId)
  const conversationData: ConversationData = {
    composerId: rawData.composerId,
    conversation: processedMessages,
    createdAt: rawData.createdAt,
    name: rawData.name,
    text: rawData.text,
    unifiedMode: rawData.unifiedMode,
    workspaceName: workspaceInfo.name, // Use info found via composerId
    workspacePath: workspaceInfo.path,
  }
  return conversationData;
}

// --- Refactored Core Extraction Logic --- 

/**
 * Extracts all conversations from the global database.
 * @param limit Optional limit on the number of conversations to fetch.
 * @returns An array of processed ConversationData objects.
 */
export async function extractGlobalConversations(limit?: number): Promise<ConversationData[]> {
  const dbPath = getCursorDbPath()
  if (!existsSync(dbPath)) {
    console.error('Global database not found at:', dbPath)
    return []
  }

  const spinner = ora('Extracting global conversations...').start()
  let db: BetterSqlite3.Database | null = null
  const conversations: ConversationData[] = []

  try {
    db = new BetterSqlite3(dbPath, { fileMustExist: true, readonly: true })

    let rows: { key: string; value: Buffer }[];

    // Prepare and execute different queries based on limit
    if (limit) {
      const sql = `
          SELECT key, value 
          FROM cursorDiskKV 
          WHERE key LIKE 'composerData:%' 
          ORDER BY key DESC 
          LIMIT @limit
        `;
      const query = db.prepare(sql);
      rows = query.all({ limit }) as { key: string; value: Buffer }[];
    } else {
      const sql = `
          SELECT key, value 
          FROM cursorDiskKV 
          WHERE key LIKE 'composerData:%' 
          ORDER BY key DESC
        `;
      const query = db.prepare(sql);
      rows = query.all() as { key: string; value: Buffer }[]; // No parameters needed
    }

    spinner.text = `Processing ${rows.length} raw conversation entries...`

    for (const row of rows) {
      try {
        const rawJson = row.value.toString('utf8')
        const parsedJson = JSON.parse(rawJson) as unknown
        // Check type inline
        if (
          typeof parsedJson === 'object' && parsedJson !== null &&
          'composerId' in parsedJson && typeof (parsedJson as RawConversationData).composerId === 'string' &&
          'createdAt' in parsedJson && typeof (parsedJson as RawConversationData).createdAt === 'number'
        ) {
          const rawData = parsedJson as RawConversationData;
          const processedData = processConversationEntry(rawData);
          if (processedData) {
            conversations.push(processedData);
          }
        }
      } catch {
        // Ignore errors processing individual entries
      }
    }

    spinner.succeed(`Successfully extracted and processed ${conversations.length} conversations.`)
  } catch (error) {
    spinner.fail(`Failed to extract conversations: ${error}`)
  } finally {
    db?.close()
  }

  // Sort final result by creation date descending
  conversations.sort((a, b) => b.createdAt - a.createdAt);
  return conversations
}

/**
 * Retrieves conversations specifically for a given workspace name.
 *
 * @param workspaceName The name of the workspace.
 * @returns A promise resolving to an array of workspace-specific conversations.
 */
export async function getConversationsForWorkspace(workspaceName: string): Promise<ConversationData[]> {
  const workspaceInfo = getWorkspaceInfo(workspaceName); // Use the refactored function
  if (!workspaceInfo) {
    return [];
  }

  // 1. Try processing directly if raw JSON was found in ItemTable
  if (workspaceInfo.rawConversationJson) {
    try {
      const rawData = JSON.parse(workspaceInfo.rawConversationJson) as RawConversationData;
      console.log('[Debug getConversationsForWorkspace] Top-level keys in rawData:', Object.keys(rawData));
      console.log('[Debug getConversationsForWorkspace] rawData:', rawData);
      // If the parsed data has a top-level conversation array, process as before
      if (typeof rawData === 'object' && rawData !== null && rawData.composerId && rawData.conversation) {
        const processed = processConversationEntry(rawData);
        if (processed) {
          console.log("[Debug getConversationsForWorkspace] Successfully processed conversation from ItemTable JSON.")
          return [processed]; // Return as an array
        }
        console.log("[Debug getConversationsForWorkspace] processConversationEntry failed for ItemTable JSON.")
      } else if (typeof rawData === 'object' && rawData !== null && Array.isArray((rawData as any).allComposers)) {
        // If the data has an allComposers array, treat each as a conversation (even if only metadata)
        const allComposers = (rawData as any).allComposers;
        console.log(`[Debug getConversationsForWorkspace] allComposers branch entered. allComposers length: ${allComposers.length}`);
        console.log(`[Debug getConversationsForWorkspace] allComposers content:`, allComposers);
        const conversations: ConversationData[] = [];
        for (const composer of allComposers) {
          if (composer && typeof composer === 'object' && composer.composerId && composer.name) {
            conversations.push({
              composerId: composer.composerId,
              createdAt: composer.createdAt || 0,
              name: composer.name,
              conversation: [], // No messages, just metadata
              workspaceName: workspaceName,
              workspacePath: undefined,
              unifiedMode: composer.unifiedMode,
              text: composer.text,
            });
          }
        }
        console.log(`[Debug getConversationsForWorkspace] conversations array after mapping allComposers:`, conversations);
        if (conversations.length > 0) {
          console.log(`[Debug getConversationsForWorkspace] Extracted ${conversations.length} conversations from allComposers in ItemTable (metadata only).`);
          // Sort by createdAt descending
          conversations.sort((a, b) => b.createdAt - a.createdAt);
          return conversations;
        }
      } else {
        console.warn("[Debug getConversationsForWorkspace] ItemTable JSON lacked expected structure (composerId/conversation or allComposers array).")
      }
    } catch (error) {
      console.error("[Debug getConversationsForWorkspace] Error parsing ItemTable JSON:", error);
    }
  }

  // 2. Fallback: If no direct JSON or processing failed, use composer IDs to query cursorDiskKV
  if (workspaceInfo.composerIds.size > 0) {
    console.log(`[Debug getConversationsForWorkspace] No direct conversation found or processed from ItemTable. Falling back to querying cursorDiskKV with ${workspaceInfo.composerIds.size} IDs.`);
    return getConversationsByIds(workspaceInfo.composerIds, workspaceInfo.dbPath);
  }

  console.log("[Debug getConversationsForWorkspace] No composer IDs found, cannot query cursorDiskKV.");
  return []; // No IDs, nothing to query
}

/**
 * Gets the latest conversation specifically for a given workspace name.
 *
 * @param workspaceName The name of the workspace.
 * @returns A promise resolving to the latest ConversationData for the workspace, or null.
 */
export async function getLatestConversationForWorkspace(workspaceName: string): Promise<ConversationData | null> {
  const workspaceInfo = getWorkspaceInfo(workspaceName); // Use the refactored function
  if (!workspaceInfo) {
    return null;
  }

  // 1. Try processing directly if raw JSON was found in ItemTable
  if (workspaceInfo.rawConversationJson) {
    try {
      const rawData = JSON.parse(workspaceInfo.rawConversationJson) as RawConversationData;
      // Ensure the parsed data has the expected top-level fields
      if (typeof rawData === 'object' && rawData !== null && rawData.composerId && rawData.conversation) {
        const processed = processConversationEntry(rawData);
        if (processed) {
          console.log("[Debug getLatestConversationForWorkspace] Successfully processed conversation from ItemTable JSON.")
          return processed;
        }

        console.log("[Debug getLatestConversationForWorkspace] processConversationEntry failed for ItemTable JSON.")

      } else {
        console.warn("[Debug getLatestConversationForWorkspace] ItemTable JSON lacked expected structure (composerId/conversation).")
      }
    } catch (error) {
      console.error("[Debug getLatestConversationForWorkspace] Error parsing ItemTable JSON:", error);
    }
  }

  // 2. Fallback: If no direct JSON or processing failed, use composer IDs to query cursorDiskKV (limit 1)
  if (workspaceInfo.composerIds.size > 0) {
    console.log(`[Debug getLatestConversationForWorkspace] No direct conversation found or processed from ItemTable. Falling back to querying cursorDiskKV with ${workspaceInfo.composerIds.size} IDs (limit 1).`);
    const conversations = await getConversationsByIds(workspaceInfo.composerIds, workspaceInfo.dbPath, 1);
    return conversations.length > 0 ? conversations[0] : null;
  }

  console.log("[Debug getLatestConversationForWorkspace] No composer IDs found, cannot query cursorDiskKV.");
  return null; // No IDs, nothing to query

}

/**
 * Gets the latest conversation from the global database.
 */
export async function getLatestConversation(): Promise<ConversationData | null> {
  // console.warn("getLatestConversation might need refactoring if used independently, uses extractGlobalConversations which is now refactored.");
  // Use the limit parameter for efficiency
  const conversations = await extractGlobalConversations(1);
  return conversations.length > 0 ? conversations[0] : null;
}

/**
 * Extracts conversations associated with specific composer IDs from a given database path.
 * Uses the 'conversationService.conversation' key format found in newer Cursor versions.
 *
 * @param composerIds A Set of composer IDs to filter by.
 * @param dbPath The path to the SQLite database file (either global or workspace-specific).
 * @param limit Optional limit on the number of conversations to return.
 * @returns A promise that resolves to an array of ConversationData.
 */
export async function getConversationsByIds(composerIds: Set<string>, dbPath: string, limit?: number): Promise<ConversationData[]> {
  if (composerIds.size === 0) {
    return []
  }

  const spinner = ora(`Extracting conversations from ${basename(dbPath)} using ${composerIds.size} IDs...`).start()
  let db: BetterSqlite3.Database | null = null;
  const conversations: ConversationData[] = []

  try {
    if (!existsSync(dbPath)) {
      spinner.fail(`Database file not found at ${dbPath}`);
      return [];
    }

    db = new BetterSqlite3(dbPath, { fileMustExist: true, readonly: true })

    // Query cursorDiskKV using the composer IDs
    const baseSql = "SELECT key, value FROM cursorDiskKV WHERE key = ?";
    const stmt = db.prepare(baseSql);
    let retrievedCount = 0;

    // Iterate through IDs and query individually, applying limit if necessary
    const sortedIds = [...composerIds].sort().reverse(); // Attempt latest first heuristic
    for (const id of sortedIds) {
      if (limit && retrievedCount >= limit) {
        break; // Stop if limit is reached
      }

      const key = `composerData:${id}`;
      const row = stmt.get(key) as undefined | { key: string, value: Buffer };

      if (row?.value) {
        retrievedCount++;
        try {
          const rawJson = row.value.toString('utf8');
          const parsedJson = JSON.parse(rawJson) as unknown;
          // Perform the same type check as in extractGlobalConversations
          if (
            typeof parsedJson === 'object' && parsedJson !== null &&
            'composerId' in parsedJson && typeof (parsedJson as RawConversationData).composerId === 'string' &&
            'createdAt' in parsedJson && typeof (parsedJson as RawConversationData).createdAt === 'number'
          ) {
            const rawData = parsedJson as RawConversationData;
            // Ensure the composerId matches the one we queried for (sanity check)
            if (rawData.composerId === id) {
              const processedData = processConversationEntry(rawData);
              if (processedData) {
                // Add workspace info if missing (useful if called directly)
                if (!processedData.workspaceName || !processedData.workspacePath) {
                  const wsInfo = findWorkspaceInfo(processedData.composerId);
                  processedData.workspaceName = wsInfo.name;
                  processedData.workspacePath = wsInfo.path;
                }

                conversations.push(processedData);
              }
            }
          }
        } catch (error) {
          spinner.warn(`
Error parsing conversation row for key ${key} in ${basename(dbPath)}: ${error instanceof Error ? error.message : String(error)}`);
          // console.error('Problematic row data:', inspect(row.value?.toString('utf8').slice(0, 500), { depth: 2 }));
        }
      }
    }

    spinner.succeed(`Successfully processed ${conversations.length} conversations from ${basename(dbPath)} (checked ${composerIds.size} IDs).`)
  } catch (error) {
    // Check for specific error: no such table: cursorDiskKV
    if (error instanceof Error && error.message.includes('no such table: cursorDiskKV')) {
      spinner.warn(`Table 'cursorDiskKV' not found in ${basename(dbPath)}. Workspace conversations might be stored differently or this DB is older.`);
    } else {
      spinner.fail(`Error accessing database at ${dbPath}: ${error instanceof Error ? error.message : String(error)}`);
      console.error(error);
    }
  } finally {
    db?.close()
  }

  // Sort final result by creation date descending (important as we fetch individually)
  conversations.sort((a, b) => b.createdAt - a.createdAt);
  return conversations;
}
