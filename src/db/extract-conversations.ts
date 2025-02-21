import BetterSqlite3 from 'better-sqlite3'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {platform} from 'node:os'
import {basename, join} from 'node:path'

import type {ConversationData, Message} from '../types.js'

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

function findWorkspaceInfo(composerId: string): {name?: string; path?: string} {
  const workspaceStoragePath = getWorkspaceStoragePath()
  if (!existsSync(workspaceStoragePath)) return {}

  // Look through each workspace directory
  const workspaces = existsSync(workspaceStoragePath) ? readdirSync(workspaceStoragePath, {withFileTypes: true}) : []

  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue

    const dbPath = join(workspaceStoragePath, workspace.name, 'state.vscdb')
    if (!existsSync(dbPath)) continue

    try {
      const db = new BetterSqlite3(dbPath, {readonly: true})
      const result = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get() as
        | undefined
        | {value: string}

      if (result) {
        const data = JSON.parse(result.value)
        if (data.allComposers?.some((c: any) => c.composerId === composerId)) {
          // Found the workspace containing this conversation
          const workspaceJsonPath = join(workspaceStoragePath, workspace.name, 'workspace.json')
          if (existsSync(workspaceJsonPath)) {
            const workspaceData = JSON.parse(readFileSync(workspaceJsonPath, 'utf8'))
            if (workspaceData.folder) {
              const path = decodeWorkspacePath(workspaceData.folder)
              return {
                name: basename(path),
                path,
              }
            }
          }
        }
      }

      db.close()
    } catch (error) {
      console.error(`Error checking workspace ${workspace.name}:`, error)
    }
  }

  return {}
}

// Get the platform-specific database path
const GLOBAL_DB_PATH = getCursorDbPath()

/**
 * Extracts conversations from the global database and returns them.
 * @returns An array of conversations
 */
export function extractGlobalConversations(): ConversationData[] {
  let dbPath: string
  try {
    dbPath = getCursorDbPath()
  } catch (error) {
    console.error('Failed to determine database path:', error)
    return []
  }

  if (!existsSync(dbPath)) {
    console.error(`Global database not found at: ${dbPath}`)
    return []
  }

  console.log(`Processing global database: ${dbPath}`)
  let db: BetterSqlite3.Database | null = null

  try {
    db = new BetterSqlite3(dbPath, {readonly: true})
    const rows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as {
      key: string
      value: string
    }[]

    console.log(`Found ${rows.length} potential conversations`)
    const conversations: ConversationData[] = []

    for (const row of rows) {
      try {
        const data = JSON.parse(row.value)
        if (data.conversation?.length) {
          const conversation = data.conversation.map((msg: Message) => {
            if (msg.codeBlocks) {
              msg.codeBlocks = msg.codeBlocks
                .map((block: unknown) => {
                  if (typeof block === 'string') {
                    try {
                      return JSON.parse(block)
                    } catch (error) {
                      console.log(`Failed to parse code block: ${error}`)
                      return null
                    }
                  }

                  return block
                })
                .filter(Boolean)
            }

            return msg
          })
          const workspaceInfo = findWorkspaceInfo(data.composerId)
          conversations.push({
            composerId: data.composerId,
            context: data.context,
            conversation,
            createdAt: data.createdAt,
            richText: data.richText,
            text: data.text,
            workspaceName: workspaceInfo.name,
            workspacePath: workspaceInfo.path,
          })
        }
      } catch (error) {
        console.log(`Failed to parse conversation data: ${error}`)
      }
    }

    if (conversations.length > 0) {
      console.log(`Found ${conversations.length} conversations with content`)
      return conversations.sort((a, b) => b.createdAt - a.createdAt)
    }

    console.log('No conversations with content found')
    return []
  } catch (error) {
    console.error('Error processing database:', error)
    return []
  } finally {
    db?.close()
  }
}
