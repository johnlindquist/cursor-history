import BetterSqlite3 from 'better-sqlite3'
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {platform} from 'node:os'
import {basename, join} from 'node:path'
import ora from 'ora'

import type {ConversationData} from '../types.js'

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
  original: {
    startLineNumber: number
    endLineNumberExclusive: number
  }
  modified: string[]
}

function processInlineDiffs(message: any): void {
  // Skip if no checkpoint or diffs
  if (!message.afterCheckpoint?.activeInlineDiffs?.length) return

  // Process each code block
  message.codeBlocks = message.codeBlocks || []

  for (const diff of message.afterCheckpoint.activeInlineDiffs) {
    const codeBlock = message.codeBlocks.find((block: any) => block.uri?.path === diff.uri?.path)

    if (diff.newTextDiffWrtV0) {
      const changes = diff.newTextDiffWrtV0.flatMap((change: DiffChange) => {
        if (change.original && change.modified?.length) {
          return [
            `// Lines ${change.original.startLineNumber}-${change.original.endLineNumberExclusive}:`,
            '// Original code removed',
            '// New code:',
            ...change.modified,
            '', // Add spacing between changes
          ]
        }

        return []
      })

      const content = changes.join('\n').trim()
      const lastChange = diff.newTextDiffWrtV0.at(-1)
      const firstChange = diff.newTextDiffWrtV0[0]

      // Update existing block or create new one
      if (codeBlock) {
        codeBlock.content = content
        codeBlock.language = codeBlock.uri.path.split('.').pop() || ''
        // Preserve the line range if it exists
        if (firstChange?.original) {
          codeBlock.start = firstChange.original.startLineNumber
          codeBlock.end = lastChange?.original.endLineNumberExclusive
        }
      } else {
        const newBlock: CodeBlock = {
          content,
          language: diff.uri.path.split('.').pop() || '',
          uri: diff.uri,
        }

        // Add line range if available
        if (firstChange?.original) {
          newBlock.start = firstChange.original.startLineNumber
          newBlock.end = lastChange?.original.endLineNumberExclusive
        }

        message.codeBlocks.push(newBlock)
      }
    }
  }
}

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
 * @param limit Optional limit on number of conversations to return
 * @returns A promise that resolves to an array of conversations
 */
export async function extractGlobalConversations(limit?: number): Promise<ConversationData[]> {
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

      // If we only need one conversation, optimize the query
      const query =
        limit === 1
          ? "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' ORDER BY CAST(json_extract(value, '$.createdAt') AS INTEGER) DESC LIMIT 1"
          : "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'"

      const rows = db.prepare(query).all() as {
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

                // Process any inline diffs in the conversation
                if (Array.isArray(parsed.conversation)) {
                  for (const message of parsed.conversation) {
                    processInlineDiffs(message)
                  }
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
        // Sort by last message's timing instead of conversation creation time
        const sorted = processedConversations.sort((a, b) => {
          const aLastMessage = a.conversation.at(-1) as any
          const bLastMessage = b.conversation.at(-1) as any

          const aTime =
            aLastMessage?.timingInfo?.clientEndTime || aLastMessage?.timingInfo?.clientSettleTime || a.createdAt
          const bTime =
            bLastMessage?.timingInfo?.clientEndTime || bLastMessage?.timingInfo?.clientSettleTime || b.createdAt

          return bTime - aTime // Sort descending
        })
        spinner.succeed(`Found ${processedConversations.length} conversations with content`)
        return limit ? sorted.slice(0, limit) : sorted
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

/**
 * Gets only the latest conversation from the database
 * @returns A promise that resolves to the latest conversation or null if none found
 */
export async function getLatestConversation(): Promise<ConversationData | null> {
  const conversations = await extractGlobalConversations(1)
  return conversations[0] || null
}
