import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {platform} from 'node:os'
import {basename, join} from 'node:path'
import {Database} from './db/sqlite-wrapper.js'

interface ConversationInfo {
  createdAt: number
  id: string
  mode: string
  name: string
  workspaceName: string
  workspacePath: string
}

interface ComposerData {
  allComposers: Array<{
    composerId: string
    createdAt: number
    name?: string
    unifiedMode?: string
  }>
}

function isComposerData(data: unknown): data is ComposerData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'allComposers' in data &&
    Array.isArray((data as ComposerData).allComposers) &&
    (data as ComposerData).allComposers.every(
      (composer) =>
        typeof composer === 'object' &&
        composer !== null &&
        'composerId' in composer &&
        typeof composer.composerId === 'string' &&
        'createdAt' in composer &&
        typeof composer.createdAt === 'number',
    )
  )
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

function getWorkspaceDbPath(workspaceId: string): string {
  return join(getWorkspaceStoragePath(), workspaceId, 'state.vscdb')
}

function listWorkspaceIds(): string[] {
  const workspaceStoragePath = getWorkspaceStoragePath()

  if (!existsSync(workspaceStoragePath)) {
    console.error(`Workspace storage directory not found at: ${workspaceStoragePath}`)
    return []
  }

  try {
    return readdirSync(workspaceStoragePath).filter(
      (id) =>
        // Filter out hidden files and non-workspace directories
        !id.startsWith('.') && existsSync(join(workspaceStoragePath, id, 'state.vscdb')),
    )
  } catch (error) {
    console.error('Failed to read workspace storage directory:', error)
    return []
  }
}

function decodeWorkspacePath(uri: string): string {
  try {
    // Remove file:// prefix and decode URI components
    const path = uri.replace(/^file:\/\//, '')
    return decodeURIComponent(path)
  } catch (error) {
    console.error('Failed to decode workspace path:', error)
    return uri
  }
}

function getWorkspaceInfo(workspaceId: string): null | {name: string; path: string} {
  const workspacePath = join(getWorkspaceStoragePath(), workspaceId)
  const workspaceJsonPath = join(workspacePath, 'workspace.json')

  try {
    const content = readFileSync(workspaceJsonPath, 'utf8')
    const data = JSON.parse(content)
    if (data && typeof data === 'object' && 'folder' in data) {
      const decodedPath = decodeWorkspacePath(data.folder as string)
      return {
        name: basename(decodedPath),
        path: decodedPath,
      }
    }
  } catch (error) {
    console.error(`Error reading workspace.json for ${workspaceId}:`, error)
  }

  return null
}

async function extractConversations(workspaceId: string): Promise<ConversationInfo[]> {
  const conversations: ConversationInfo[] = []
  const dbPath = getWorkspaceDbPath(workspaceId)
  const workspaceInfo = getWorkspaceInfo(workspaceId)

  if (!workspaceInfo) {
    console.error(`Could not get workspace info for ${workspaceId}`)
    return []
  }

  let db: Database | null = null
  try {
    db = new Database(dbPath, {fileMustExist: true, readonly: true})

    // Get composer data which contains conversations
    const composerData = await db.prepare(`SELECT value FROM ItemTable WHERE key = 'composer.composerData'`).get()

    if (!composerData) return []

    const parsed = JSON.parse(composerData.value) as unknown
    if (!isComposerData(parsed)) {
      console.error(`Invalid composer data structure in workspace ${workspaceId}`)
      return []
    }

    for (const composer of parsed.allComposers) {
      if (composer.name) {
        // Only include named conversations
        conversations.push({
          createdAt: composer.createdAt,
          id: composer.composerId,
          mode: composer.unifiedMode || 'unknown',
          name: composer.name,
          workspaceName: workspaceInfo.name,
          workspacePath: workspaceInfo.path,
        })
      }
    }
  } catch (error) {
    console.error(`Error processing workspace ${workspaceId}:`, error)
  } finally {
    if (db) await db.close()
  }

  return conversations
}

async function main() {
  const fsWorkspaceIds = listWorkspaceIds()
  console.log(`Found ${fsWorkspaceIds.length} workspaces\n`)

  const allConversations: ConversationInfo[] = []

  // Get conversations from each workspace
  for (const id of fsWorkspaceIds) {
    const conversations = await extractConversations(id)
    allConversations.push(...conversations)
  }

  // Sort conversations by creation date (newest first)
  allConversations.sort((a, b) => b.createdAt - a.createdAt)

  // Group conversations by workspace
  const conversationsByWorkspace = new Map<string, ConversationInfo[]>()
  for (const conv of allConversations) {
    const existing = conversationsByWorkspace.get(conv.workspaceName) || []
    existing.push(conv)
    conversationsByWorkspace.set(conv.workspaceName, existing)
  }

  // Print conversations grouped by workspace
  console.log('=== Conversations by Workspace ===\n')
  for (const [workspace, conversations] of conversationsByWorkspace.entries()) {
    console.log(`Workspace: ${workspace}`)
    console.log(`Path: ${conversations[0].workspacePath}`)
    console.log('Conversations:')
    for (const conv of conversations) {
      const date = new Date(conv.createdAt).toLocaleString()
      console.log(`- [${conv.mode}] ${conv.name} (${date})`)
    }

    console.log()
  }

  // Print some stats
  console.log('=== Statistics ===')
  console.log(`Total workspaces: ${conversationsByWorkspace.size}`)
  console.log(`Total conversations: ${allConversations.length}`)
  console.log(
    `Average conversations per workspace: ${(allConversations.length / conversationsByWorkspace.size).toFixed(1)}`,
  )
}

await main().catch(console.error)
