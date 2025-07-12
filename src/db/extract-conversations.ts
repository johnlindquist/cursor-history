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

// Export these for use in optimized version
export { decodeWorkspacePath, getCursorDbPath, getWorkspaceStoragePath, objectContainsString }

// Cache for workspace lookups to avoid repeated file system operations
const workspacePathCache = new Map<string, { dir: string; path: string }>()

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
export interface RawConversationData {
  composerId: string
  context?: unknown
  conversation: ConversationItem[] // Use new type
  createdAt: number
  name?: string
  text?: string
  unifiedMode?: string
}

// Union type for all possible database JSON structures
interface DatabaseConversationData extends Partial<RawConversationData> {
  // Allow other potential database fields
  [key: string]: unknown
  allComposers?: Array<{
    [key: string]: unknown
    composerId: string
    context?: unknown
    conversation?: ConversationItem[]
    conversationMap?: Record<string, unknown>
    createdAt?: number
    fullConversationHeadersOnly?: Array<{ [key: string]: unknown;bubbleId: string; }>
    name?: string
    text?: string
    unifiedMode?: string
  }>
  conversationMap?: Record<string, unknown>
  fullConversationHeadersOnly?: Array<{ [key: string]: unknown;bubbleId: string; }>
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
    // biome-ignore lint/suspicious/noConsole: <explanation>
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
      // biome-ignore lint/suspicious/noConsole: Debug output needed
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
      // biome-ignore lint/suspicious/noConsole: Debug output needed
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
    // First try exact path match, then basename match, then path contains
    const pathLower = workspacePath.toLowerCase();
    const exactPathMatch = pathLower === nameLower || pathLower === nameLower.replaceAll('\\', '/');
    const basenameMatch = currentWorkspaceName.toLowerCase() === nameLower;
    const pathContainsMatch = pathLower.includes(nameLower);

    if (!exactPathMatch && !basenameMatch && !pathContainsMatch) {
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
export function processConversationEntry(rawData: RawConversationData): ConversationData | null {
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
    // biome-ignore lint/suspicious/noConsole: <explanation>
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
        const parsedJson = JSON.parse(rawJson) as DatabaseConversationData

        // We need at least composerId and createdAt to proceed
        if (
          !(parsedJson && typeof parsedJson === 'object' && 'composerId' in parsedJson && typeof parsedJson.composerId === 'string') ||
          !("createdAt" in parsedJson && typeof parsedJson.createdAt === 'number')
        ) {
          continue
        }

        let items: ConversationItem[] = []

        // 1) Already has full conversation array
        if (Array.isArray(parsedJson.conversation) && parsedJson.conversation.length > 0) {
          items = parsedJson.conversation
        }

        // 2) Try to rebuild from conversationMap (sometimes present)
        if (items.length === 0 && parsedJson.conversationMap && typeof parsedJson.conversationMap === 'object') {
          items = Object.values(parsedJson.conversationMap) as ConversationItem[]
        }

        // 3) Try to rebuild from fullConversationHeadersOnly + bubbleId keys
        if (items.length === 0 && Array.isArray(parsedJson.fullConversationHeadersOnly)) {
          const stmtBubble = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
          for (const header of parsedJson.fullConversationHeadersOnly) {
            if (header && header.bubbleId) {
              const bubbleKey = `bubbleId:${parsedJson.composerId}:${header.bubbleId}`
              const bubbleRow = stmtBubble.get(bubbleKey) as undefined | { value: Buffer }
              if (bubbleRow?.value) {
                try {
                  const bubbleMsg = JSON.parse(bubbleRow.value.toString('utf8'))
                  items.push(bubbleMsg)
                } catch {
                  /* ignore malformed */
                }
              }
            }
          }
        }

        // If still empty, skip
        if (items.length === 0) {
          continue
        }

        const rawData: RawConversationData = {
          composerId: parsedJson.composerId,
          context: parsedJson.context,
          conversation: items,
          createdAt: parsedJson.createdAt,
          name: parsedJson.name,
          text: parsedJson.text,
          unifiedMode: parsedJson.unifiedMode,
        }

        const processedData = processConversationEntry(rawData)
        if (processedData) {
          conversations.push(processedData)
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
 * Helper: recursively search all string fields for a match
 */
function objectContainsString(obj: unknown, needle: string): boolean {
  if (!obj) return false;
  if (typeof obj === 'string') return obj.toLowerCase().includes(needle);
  if (Array.isArray(obj)) return obj.some((el) => objectContainsString(el, needle));
  if (typeof obj === 'object') return Object.values(obj).some((v) => objectContainsString(v, needle));
  return false;
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

  // Check cache first
  let foundWorkspaceDir: null | string = null
  
  if (workspacePathCache.has(nameLower)) {
    const cached = workspacePathCache.get(nameLower)!
    foundWorkspaceDir = cached.dir
  } else {
    // Scan workspaces
    const workspaces = readdirSync(workspaceStoragePath, { withFileTypes: true })
    
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

      // First try exact path match, then basename match, then path contains
      const pathLower = workspacePath.toLowerCase();
      const exactPathMatch = pathLower === nameLower || pathLower === nameLower.replaceAll('\\', '/');
      const basenameMatch = currentWorkspaceName.toLowerCase() === nameLower;
      const pathContainsMatch = pathLower.includes(nameLower);

      if (exactPathMatch || basenameMatch || pathContainsMatch) {
        foundWorkspaceDir = workspace.name
        // Cache the result
        workspacePathCache.set(nameLower, { dir: foundWorkspaceDir, path: workspacePath })
        break
      }
    }
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
  const conversations: ConversationData[] = []
  try {
    db = new BetterSqlite3(dbPath, { fileMustExist: true, readonly: true })
    const result = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get() as undefined | { value: string }
    if (workspaceName.toLowerCase() === 'file-forge') {
      console.log('[DEBUG] file-forge composer.composerData result:', result);
    }

    if (result?.value) {
      const parsed = JSON.parse(result.value) as DatabaseConversationData

      if (parsed && Array.isArray(parsed.allComposers)) {
        const metadataOnly: { composerId: string; meta: ConversationData }[] = []
        for (const composer of parsed.allComposers) {
          if (composer.conversation && composer.conversation.length > 0) {
            // Process the conversation through processConversationEntry
            const rawData: RawConversationData = {
              composerId: composer.composerId,
              context: composer.context,
              conversation: composer.conversation,
              createdAt: composer.createdAt || Date.now(),
              name: composer.name,
              text: composer.text,
              unifiedMode: composer.unifiedMode
            }
            const processedData = processConversationEntry(rawData)
            if (processedData) {
              conversations.push(processedData)
            }
          } else if (composer.fullConversationHeadersOnly) {
            // Try to reconstruct conversation from workspace DB bubbleId keys
            const items: ConversationItem[] = []
            // First try to get messages from conversationMap if it exists
            if (composer.conversationMap && typeof composer.conversationMap === 'object') {
              for (const header of composer.fullConversationHeadersOnly) {
                if (header.bubbleId && composer.conversationMap[header.bubbleId]) {
                  items.push(composer.conversationMap[header.bubbleId] as ConversationItem)
                }
              }
            }

            // If no conversationMap or items, try to fetch from DB
            if (items.length === 0) {
              for (const header of composer.fullConversationHeadersOnly) {
                if (header.bubbleId) {
                  // Look for bubbleId:[composerId]:[bubbleId] in the same workspace DB
                  const bubbleKey = `bubbleId:${composer.composerId}:${header.bubbleId}`
                  const bubbleRow = (db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(bubbleKey) ??
                    db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(bubbleKey)) as undefined | { value: Buffer | string }
                  if (bubbleRow?.value) {
                    try {
                      const bubbleMsg = JSON.parse(typeof bubbleRow.value === 'string' ? bubbleRow.value : bubbleRow.value.toString('utf8'))
                      items.push(bubbleMsg as ConversationItem)
                    } catch {
                      // Ignore parse errors
                    }
                  }
                }
              }
            }

            if (items.length > 0) {
              // Process the reconstructed conversation through processConversationEntry
              const rawData: RawConversationData = {
                composerId: composer.composerId,
                context: composer.context,
                conversation: items as ConversationItem[],
                createdAt: composer.createdAt || Date.now(),
                name: composer.name,
                text: composer.text,
                unifiedMode: composer.unifiedMode
              }
              const processedData = processConversationEntry(rawData)
              if (processedData) {
                conversations.push(processedData)
              }
            } else {
              // No conversation data found locally, will need to fetch from global DB
              metadataOnly.push({ composerId: composer.composerId, meta: composer as any })
            }
          } else {
            metadataOnly.push({ composerId: composer.composerId, meta: composer as any })
          }
        }

        // Try to fetch full conversation data from global DB for metadata-only entries
        if (metadataOnly.length > 0) {
          const globalDbPath = getCursorDbPath()
          const globalDb = new BetterSqlite3(globalDbPath, { fileMustExist: true, readonly: true })
          try {
            for (const meta of metadataOnly) {
              const key = `composerData:${meta.composerId}`
              const row = globalDb.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(key) as undefined | { value: Buffer }
              if (row?.value) {
                try {
                  const rawJson = row.value.toString('utf8')
                  const parsed = JSON.parse(rawJson)
                  // Try to reconstruct conversation if only headers/map exist
                  let items: any[] = [];
                  if (Array.isArray(parsed.conversation) && parsed.conversation.length > 0) {
                    items = parsed.conversation;
                  } else if (Array.isArray(parsed.fullConversationHeadersOnly)) {
                    // First try conversationMap
                    if (parsed.conversationMap && typeof parsed.conversationMap === 'object') {
                      for (const header of parsed.fullConversationHeadersOnly) {
                        if (header.bubbleId && parsed.conversationMap[header.bubbleId]) {
                          items.push(parsed.conversationMap[header.bubbleId] as ConversationItem);
                        }
                      }
                    }

                    // If still no items, try fetching individual bubble messages from global DB
                    if (items.length === 0) {
                      for (const header of parsed.fullConversationHeadersOnly) {
                        if (header.bubbleId) {
                          const bubbleKey = `bubbleId:${parsed.composerId}:${header.bubbleId}`
                          const bubbleRow = globalDb.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(bubbleKey) as undefined | { value: Buffer }
                          if (bubbleRow?.value) {
                            try {
                              const bubbleMsg = JSON.parse(bubbleRow.value.toString('utf8'))
                              items.push(bubbleMsg as ConversationItem)
                            } catch {
                              // Ignore parse errors
                            }
                          }
                        }
                      }
                    }
                  }

                  const hasConversation = items.length > 0;
                  if (hasConversation) {
                    // Process through processConversationEntry
                    const rawData: RawConversationData = {
                      composerId: parsed.composerId,
                      context: parsed.context,
                      conversation: items,
                      createdAt: parsed.createdAt,
                      name: parsed.name,
                      text: parsed.text,
                      unifiedMode: parsed.unifiedMode
                    }
                    const processedData = processConversationEntry(rawData)
                    if (processedData) {
                      conversations.push(processedData)
                    }
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          } finally {
            globalDb.close()
          }
        }


        // Fallback: If still no conversations, try context-based global scan
        if (conversations.length === 0 && foundWorkspaceDir) {
          // Get the full workspace path from workspace.json
          const workspaceJsonPath = join(workspaceStoragePath, foundWorkspaceDir, 'workspace.json');
          let matchPath = '';
          if (existsSync(workspaceJsonPath)) {
            try {
              const workspaceData = JSON.parse(readFileSync(workspaceJsonPath, 'utf8'));
              if (workspaceData.folder) {
                matchPath = decodeWorkspacePath(workspaceData.folder).toLowerCase();
              }
            } catch { }
          }

          if (matchPath) {
            const globalDbPath = getCursorDbPath();
            if (existsSync(globalDbPath)) {
              let globalDb: BetterSqlite3.Database | null = null;
              try {
                globalDb = new BetterSqlite3(globalDbPath, { fileMustExist: true });
                
                // First pass: find matching conversations and check if we need bubble reconstruction
                const stmt = globalDb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'");
                const matchingComposers: Array<{ key: string; parsed: DatabaseConversationData }> = [];
                let needsBubbleReconstruction = false;
                
                // Use iterator for better memory efficiency
                for (const row of stmt.iterate() as IterableIterator<{ key: string; value: Buffer }>) {
                  try {
                    const rawJson = row.value.toString('utf8');
                    
                    // Quick pre-check to avoid parsing non-matching entries
                    if (!rawJson.toLowerCase().includes(matchPath.toLowerCase())) continue;
                    
                    const parsed = JSON.parse(rawJson);
                    if (objectContainsString(parsed, matchPath)) {
                      matchingComposers.push({ key: row.key, parsed });
                      
                      // Check if this composer needs bubble reconstruction
                      if (Array.isArray(parsed.fullConversationHeadersOnly) && parsed.fullConversationHeadersOnly.length > 0 &&
                          (!parsed.conversation || parsed.conversation.length === 0)) {
                        needsBubbleReconstruction = true;
                      }
                    }
                  } catch { }
                }
                
                // Only build bubble map if needed
                const globalBubbleMap: Record<string, ConversationItem> = {};
                if (needsBubbleReconstruction) {
                  // Build bubble map only from the matching composers' bubble IDs
                  const neededBubbleIds = new Set<string>();
                  for (const { parsed } of matchingComposers) {
                    if (Array.isArray(parsed.fullConversationHeadersOnly)) {
                      for (const header of parsed.fullConversationHeadersOnly) {
                        if (header.bubbleId) neededBubbleIds.add(header.bubbleId);
                      }
                    }
                  }
                  
                  // Fetch only the needed bubble messages
                  const bubbleStmt = globalDb.prepare('SELECT value FROM cursorDiskKV WHERE key = ?');
                  for (const composerData of matchingComposers) {
                    const {parsed} = composerData;
                    if (Array.isArray(parsed.fullConversationHeadersOnly)) {
                      for (const header of parsed.fullConversationHeadersOnly) {
                        if (header.bubbleId && neededBubbleIds.has(header.bubbleId)) {
                          const bubbleKey = `bubbleId:${parsed.composerId}:${header.bubbleId}`;
                          const bubbleRow = bubbleStmt.get(bubbleKey) as undefined | { value: Buffer };
                          if (bubbleRow?.value) {
                            try {
                              const bubbleMsg = JSON.parse(bubbleRow.value.toString('utf8'));
                              globalBubbleMap[header.bubbleId] = bubbleMsg;
                            } catch { }
                          }
                        }
                      }
                    }
                  }
                }
                
                // Process matching composers
                for (const { key, parsed } of matchingComposers) {
                  const hasConv = parsed.conversation && Array.isArray(parsed.conversation);
                  const convLen = hasConv ? parsed.conversation!.length : 0;
                  
                  if (hasConv && convLen > 0) {
                    // Process through processConversationEntry
                    const rawData: RawConversationData = {
                      composerId: parsed.composerId || key.replace('composerData:', ''),
                      context: parsed.context,
                      conversation: parsed.conversation!,
                      createdAt: parsed.createdAt || Date.now(),
                      name: parsed.name,
                      text: parsed.text,
                      unifiedMode: parsed.unifiedMode
                    }
                    const processedData = processConversationEntry(rawData)
                    if (processedData) {
                      conversations.push(processedData)
                    }
                  } else if (Array.isArray(parsed.fullConversationHeadersOnly) && needsBubbleReconstruction) {
                    // Reconstruct conversation from headers using global bubble map
                    const items: ConversationItem[] = [];
                    for (const header of parsed.fullConversationHeadersOnly) {
                      if (header.bubbleId && globalBubbleMap[header.bubbleId]) {
                        items.push(globalBubbleMap[header.bubbleId]);
                      }
                    }

                    if (items.length > 0) {
                      // Process through processConversationEntry
                      const rawData: RawConversationData = {
                        composerId: parsed.composerId || key.replace('composerData:', ''),
                        context: parsed.context,
                        conversation: items,
                        createdAt: parsed.createdAt || Date.now(),
                        name: parsed.name,
                        text: parsed.text,
                        unifiedMode: parsed.unifiedMode
                      }
                      const processedData = processConversationEntry(rawData)
                      if (processedData) {
                        conversations.push(processedData)
                      }
                    }
                  }
                }
              } finally {
                if (globalDb) globalDb.close();
              }
            }
          }
        }

        conversations.sort((a, b) => b.createdAt - a.createdAt)
        spinner.succeed(`Found ${conversations.length} conversations for workspace "${workspaceName}".`)
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
