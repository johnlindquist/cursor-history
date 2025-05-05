import BetterSqlite3 from 'better-sqlite3'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { platform } from 'node:os'
import { basename, join } from 'node:path'
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

// --- NEW HELPER: Get Composer IDs for a Workspace --- 
function getWorkspaceComposerIds(workspaceName: string): Set<string> {
  const composerIds = new Set<string>()
  const workspaceStoragePath = getWorkspaceStoragePath()
  const nameLower = workspaceName.toLowerCase()

  if (!existsSync(workspaceStoragePath)) return composerIds

  const workspaces = readdirSync(workspaceStoragePath, { withFileTypes: true })

  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue

    const workspaceJsonPath = join(workspaceStoragePath, workspace.name, 'workspace.json')
    if (!existsSync(workspaceJsonPath)) continue

    let workspacePath = '';
    let currentWorkspaceName = '';
    try {
      const workspaceData = JSON.parse(readFileSync(workspaceJsonPath, 'utf8'))
      if (workspaceData.folder) {
        workspacePath = decodeWorkspacePath(workspaceData.folder)
        currentWorkspaceName = basename(workspacePath)
      } else {
        continue; // Skip if no folder info
      }
    } catch {
      // console.error(`Error reading workspace JSON ${workspace.name}:`, error)
      continue;
    }

    // Check if this workspace matches the target name (case-insensitive)
    // Match if basename is the same OR if the full path contains the name
    if (currentWorkspaceName.toLowerCase() !== nameLower && !workspacePath.toLowerCase().includes(nameLower)) {
      continue;
    }

    // Found a matching workspace, now read its DB for composer IDs
    const dbPath = join(workspaceStoragePath, workspace.name, 'state.vscdb')
    if (!existsSync(dbPath)) continue

    let db: BetterSqlite3.Database | null = null;
    try {
      db = new BetterSqlite3(dbPath, { fileMustExist: true, readonly: true })
      const result = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get() as undefined | { value: string }

      if (result?.value) {
        const parsed = JSON.parse(result.value) as unknown
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'allComposers' in parsed &&
          Array.isArray(parsed.allComposers)
        ) {
          for (const composer of parsed.allComposers) {
            if (typeof composer === 'object' && composer !== null && 'composerId' in composer && typeof composer.composerId === 'string') {
              composerIds.add(composer.composerId)
            }
          }
        }
      }
    } catch {
      // console.error(`Error reading workspace DB ${dbPath}:`, error)
    } finally {
      db?.close()
    }
  }

  return composerIds
}

// --- NEW HELPER: Process a single conversation entry --- 
function processConversationEntry(rawData: RawConversationData): ConversationData | null {
  const processedMessages: Message[] = []

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
    let rows: { key: string; value: Buffer }[] = [];
    if (limit) {
      const query = db.prepare(`
        SELECT key, value 
        FROM cursorDiskKV 
        WHERE key LIKE 'composerData:%' 
        ORDER BY key DESC 
        LIMIT ${limit}
      `);
      rows = query.all() as { key: string; value: Buffer }[];
    } else {
      const query = db.prepare(`
        SELECT key, value 
        FROM cursorDiskKV 
        WHERE key LIKE 'composerData:%' 
        ORDER BY key DESC
      `);
      rows = query.all() as { key: string; value: Buffer }[];
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
          'conversation' in parsedJson && Array.isArray((parsedJson as RawConversationData).conversation) &&
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
 * Gets conversations for a specific workspace.
 */
export async function getConversationsForWorkspace(workspaceName: string): Promise<ConversationData[]> {
  const spinner = ora(`Finding conversations for workspace "${workspaceName}"...`).start()
  const workspaceStoragePath = getWorkspaceStoragePath()
  const nameLower = workspaceName.toLowerCase()

  if (!existsSync(workspaceStoragePath)) {
    spinner.info(`Workspace storage not found.`)
    return []
  }

  const workspaces = readdirSync(workspaceStoragePath, { withFileTypes: true })
  let foundWorkspaceDir: string | null = null

  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue
    const workspaceJsonPath = join(workspaceStoragePath, workspace.name, 'workspace.json')
    if (!existsSync(workspaceJsonPath)) continue
    let workspacePath = ''
    let currentWorkspaceName = ''
    try {
      const workspaceData = JSON.parse(readFileSync(workspaceJsonPath, 'utf8'))
      if (workspaceData.folder) {
        workspacePath = decodeWorkspacePath(workspaceData.folder)
        currentWorkspaceName = basename(workspacePath)
      } else {
        continue
      }
    } catch {
      continue
    }
    if (currentWorkspaceName.toLowerCase() !== nameLower && !workspacePath.toLowerCase().includes(nameLower)) {
      continue
    }
    foundWorkspaceDir = workspace.name
    break
  }

  if (!foundWorkspaceDir) {
    spinner.info(`No matching workspace found for "${workspaceName}".`)
    return []
  }

  // Open the workspace DB and check ItemTable for allComposers
  const dbPath = join(workspaceStoragePath, foundWorkspaceDir, 'state.vscdb')
  if (!existsSync(dbPath)) {
    spinner.fail(`Workspace DB not found at ${dbPath}`)
    return []
  }
  let db: BetterSqlite3.Database | null = null
  try {
    db = new BetterSqlite3(dbPath, { fileMustExist: true, readonly: true })
    const result = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get() as undefined | { value: string }
    if (result?.value) {
      const parsed = JSON.parse(result.value) as any
      if (parsed && Array.isArray(parsed.allComposers)) {
        const conversations: ConversationData[] = []
        for (const composer of parsed.allComposers) {
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
            })
          }
        }
        spinner.succeed(`Found ${conversations.length} conversations (metadata only) for workspace "${workspaceName}" from allComposers.`)
        conversations.sort((a, b) => b.createdAt - a.createdAt)
        return conversations
      }
    }
  } catch (error) {
    spinner.fail(`Error reading workspace DB: ${error}`)
    return []
  } finally {
    db?.close()
  }

  // Fallback: Use old logic (cursorDiskKV in global DB)
  spinner.info(`No allComposers found, falling back to global DB lookup for workspace "${workspaceName}".`)
  const composerIds = getWorkspaceComposerIds(workspaceName)
  if (composerIds.size === 0) {
    spinner.info(`No composer IDs found for workspace "${workspaceName}".`)
    return []
  }
  const globalDbPath = getCursorDbPath()
  if (!existsSync(globalDbPath)) {
    spinner.fail('Global database not found.')
    return []
  }
  let globalDb: BetterSqlite3.Database | null = null
  const conversations: ConversationData[] = []
  try {
    globalDb = new BetterSqlite3(globalDbPath, { fileMustExist: true, readonly: true })
    const stmt = globalDb.prepare("SELECT value FROM cursorDiskKV WHERE key = ?")
    for (const id of composerIds) {
      const key = `composerData:${id}`
      const row = stmt.get(key) as undefined | { value: Buffer }
      if (row?.value) {
        try {
          const rawJson = row.value.toString('utf8')
          const parsedJson = JSON.parse(rawJson) as unknown
          if (
            typeof parsedJson === 'object' && parsedJson !== null &&
            'composerId' in parsedJson && typeof (parsedJson as RawConversationData).composerId === 'string' &&
            'conversation' in parsedJson && Array.isArray((parsedJson as RawConversationData).conversation) &&
            'createdAt' in parsedJson && typeof (parsedJson as RawConversationData).createdAt === 'number'
          ) {
            const rawData = parsedJson as RawConversationData
            const processedData = processConversationEntry(rawData)
            if (processedData) {
              processedData.workspaceName = workspaceName
              processedData.workspacePath = listWorkspaces().find(ws => ws.name === workspaceName)?.path || ''
              conversations.push(processedData)
            }
          }
        } catch {
          // Ignore errors for individual entries
        }
      }
    }
    spinner.succeed(`Found ${conversations.length} conversations for workspace "${workspaceName}" from global DB.`)
  } catch (error) {
    spinner.fail(`Error fetching workspace conversations from global DB: ${error}`)
  } finally {
    globalDb?.close()
  }
  conversations.sort((a, b) => b.createdAt - a.createdAt)
  return conversations
}

/**
 * Gets the latest conversation for a specific workspace.
 */
export async function getLatestConversationForWorkspace(workspaceName: string): Promise<ConversationData | null> {
  const conversations = await getConversationsForWorkspace(workspaceName);
  // Already sorted by getConversationsForWorkspace
  return conversations.length > 0 ? conversations[0] : null;
}

// --- Global Latest Function --- 
export async function getLatestConversation(): Promise<ConversationData | null> {
  // console.warn("getLatestConversation might need refactoring if used independently, uses extractGlobalConversations which is now refactored.");
  // Use the limit parameter for efficiency
  const conversations = await extractGlobalConversations(1);
  return conversations.length > 0 ? conversations[0] : null;
}
