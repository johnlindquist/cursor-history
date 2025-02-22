import BetterSqlite3 from 'better-sqlite3'
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {platform} from 'node:os'
import {basename, join} from 'node:path'
import ora from 'ora'

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
 * @returns A promise that resolves to an array of conversations
 */
export async function extractGlobalConversations(): Promise<ConversationData[]> {
  const spinner = ora({
    color: 'cyan',
    spinner: 'dots',
    text: 'Determining database path...',
  }).start()

  let dbPath: string
  try {
    dbPath = getCursorDbPath()
    spinner.text = 'Database path found, checking existence...'
    await new Promise((r) => setTimeout(r, 50))

    if (!existsSync(dbPath)) {
      spinner.fail(`Global database not found at: ${dbPath}`)
      return []
    }

    spinner.text = `Opening database connection: ${dbPath}`
    await new Promise((r) => setTimeout(r, 50))

    let db: BetterSqlite3.Database | null = null

    try {
      db = new BetterSqlite3(dbPath, {readonly: true})
      spinner.text = 'Connected to database, querying conversations...'
      await new Promise((r) => setTimeout(r, 50))

      const rows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as {
        key: string
        value: string
      }[]

      spinner.text = `Found ${rows.length} potential conversations, beginning processing...`
      await new Promise((r) => setTimeout(r, 50))

      const conversations: ConversationData[] = []
      let processed = 0

      for (const row of rows) {
        try {
          const data = JSON.parse(row.value)
          if (data.conversation?.length) {
            processed++
            if (processed % 10 === 0) {
              spinner.text = `Processing conversations... (${processed}/${rows.length})`
              // Reduced delay to make progress feel snappier
              await new Promise((r) => setTimeout(r, 10))
            }

            const conversation = data.conversation.map((msg: Message) => {
              if (msg.codeBlocks) {
                msg.codeBlocks = msg.codeBlocks
                  .map((block: unknown) => {
                    // If block is a string, try to parse it
                    if (typeof block === 'string') {
                      try {
                        const parsed = JSON.parse(block)
                        // Ensure we have either content or code
                        if (!parsed.content && !parsed.code) {
                          return null
                        }

                        return parsed
                      } catch {
                        // If it fails to parse as JSON, it might be direct code content
                        return {
                          content: block,
                          language: 'text',
                        }
                      }
                    }

                    // If block is already an object
                    if (block && typeof block === 'object') {
                      // Ensure we have either content or code property
                      if (!('content' in block) && !('code' in block)) {
                        return null
                      }

                      return block
                    }

                    return null
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
              name: data.name || `Conversation ${data.composerId}`,
              richText: data.richText,
              text: data.text,
              workspaceName: workspaceInfo.name,
              workspacePath: workspaceInfo.path,
            })
          }
        } catch (error) {
          spinner.text = `Processing conversations... (${processed}/${rows.length})`
          spinner.warn(`Failed to parse conversation data: ${error}`)
          await new Promise((r) => setTimeout(r, 50))
        }
      }

      if (conversations.length > 0) {
        spinner.succeed(`Found ${conversations.length} conversations with content`)
        return conversations.sort((a, b) => b.createdAt - a.createdAt)
      }

      spinner.info('No conversations with content found')
      return []
    } catch (error) {
      spinner.fail('Error processing database')
      console.error('Error:', error)
      return []
    } finally {
      db?.close()
    }
  } catch (error) {
    spinner.fail('Failed to determine database path')
    console.error('Error:', error)
    return []
  }
}
