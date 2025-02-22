import BetterSqlite3 from 'better-sqlite3'
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {platform} from 'node:os'
import {basename, join} from 'node:path'
import ora from 'ora'

import type {ConversationData} from '../types.js'

// Type guard for composer data
interface ComposerData {
  composerId: string
  context?: unknown
  conversation: unknown[]
  createdAt: number
  name?: string
  richText?: boolean
  text?: string
  unifiedMode?: string
}

function isComposerData(data: unknown): data is ComposerData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'composerId' in data &&
    typeof (data as ComposerData).composerId === 'string' &&
    'conversation' in data &&
    Array.isArray((data as ComposerData).conversation) &&
    'createdAt' in data &&
    typeof (data as ComposerData).createdAt === 'number'
  )
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
    await new Promise<void>((r) => {
      setTimeout(r, 50)
    })

    if (!existsSync(dbPath)) {
      spinner.fail(`Global database not found at: ${dbPath}`)
      return []
    }

    spinner.text = `Opening database connection: ${dbPath}`
    await new Promise<void>((r) => {
      setTimeout(r, 50)
    })

    let db: BetterSqlite3.Database | null = null

    try {
      db = new BetterSqlite3(dbPath, {readonly: true})
      spinner.text = 'Connected to database, querying conversations...'
      await new Promise<void>((r) => {
        setTimeout(r, 50)
      })

      const rows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as {
        key: string
        value: string
      }[]

      spinner.text = `Found ${rows.length} potential conversations, beginning processing...`
      await new Promise<void>((r) => {
        setTimeout(r, 50)
      })

      const processedConversations: ConversationData[] = []
      const batchSize = 10
      const batches = []

      for (let i = 0; i < rows.length; i += batchSize) {
        batches.push(rows.slice(i, i + batchSize))
      }

      // Process all batches in parallel
      await Promise.all(
        batches.map(async (batch) => {
          const batchResults = await Promise.all(
            batch.map(async (row) => {
              try {
                const parsed = JSON.parse(row.value) as unknown
                if (!isComposerData(parsed)) {
                  console.error(`Invalid data structure in row ${row.key}`)
                  return null
                }

                // Get workspace info for this conversation
                const workspaceInfo = findWorkspaceInfo(parsed.composerId)

                return {
                  composerId: parsed.composerId,
                  context: parsed.context,
                  conversation: parsed.conversation,
                  createdAt: parsed.createdAt,
                  name: parsed.name,
                  richText: parsed.richText,
                  text: parsed.text,
                  unifiedMode: parsed.unifiedMode,
                  workspaceName: workspaceInfo.name,
                  workspacePath: workspaceInfo.path,
                } as ConversationData
              } catch (error) {
                console.error(`Error processing row ${row.key}:`, error)
                return null
              }
            }),
          )

          const validResults = batchResults.filter(
            (result): result is ConversationData =>
              result !== null &&
              typeof result.composerId === 'string' &&
              Array.isArray(result.conversation) &&
              typeof result.createdAt === 'number',
          )
          processedConversations.push(...validResults)
        }),
      )

      if (processedConversations.length > 0) {
        spinner.succeed(`Found ${processedConversations.length} conversations with content`)
        return processedConversations.sort((a, b) => b.createdAt - a.createdAt)
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
