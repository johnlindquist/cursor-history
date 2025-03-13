import BetterSqlite3 from 'better-sqlite3'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { platform } from 'node:os'
import { basename, join } from 'node:path'
import ora from 'ora'

import type { ConversationData } from '../types.js'

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

/**
 * Lists all available workspaces.
 * @returns An array of workspace objects with name and path properties
 */
export function listWorkspaces(): Array<{ name: string; path: string; id: string }> {
  const workspaceStoragePath = getWorkspaceStoragePath()
  if (!existsSync(workspaceStoragePath)) return []

  // Look through each workspace directory
  const workspaces = existsSync(workspaceStoragePath) ? readdirSync(workspaceStoragePath, { withFileTypes: true }) : []
  const result: Array<{ name: string; path: string; id: string }> = []

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
          name,
          path,
          id: workspace.name,
        })
      }
    } catch (error) {
      console.error(`Error reading workspace ${workspace.name}:`, error)
    }
  }

  return result
}

function findWorkspaceInfo(composerId: string): { name?: string; path?: string } {
  const workspaceStoragePath = getWorkspaceStoragePath()
  if (!existsSync(workspaceStoragePath)) return {}

  // Look through each workspace directory
  const workspaces = existsSync(workspaceStoragePath) ? readdirSync(workspaceStoragePath, { withFileTypes: true }) : []

  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue

    const dbPath = join(workspaceStoragePath, workspace.name, 'state.vscdb')
    if (!existsSync(dbPath)) continue

    try {
      const db = new BetterSqlite3(dbPath, { readonly: true })
      const result = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get() as
        | undefined
        | { value: string }

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
      db = new BetterSqlite3(dbPath, { readonly: true })
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
 * Retrieves all conversations for a specific workspace.
 * @param workspaceName The name of the workspace to filter by
 * @returns A promise that resolves to an array of conversations for the workspace
 */
export async function getConversationsForWorkspace(workspaceName: string): Promise<ConversationData[]> {
  const spinner = ora({
    color: 'cyan',
    spinner: 'dots',
    text: `Finding conversations for workspace "${workspaceName}"...`,
  }).start()

  try {
    const dbPath = getCursorDbPath()
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

    const db = new BetterSqlite3(dbPath, { readonly: true })

    try {
      // First, build a mapping of composerIds to workspaces for the target workspace
      spinner.text = `Building composerId mapping for workspace "${workspaceName}"...`
      await new Promise<void>((r) => {
        setTimeout(r, 50)
      })

      const composerIdsForWorkspace = new Set<string>()
      const workspaceStoragePath = getWorkspaceStoragePath()

      if (existsSync(workspaceStoragePath)) {
        const workspaces = readdirSync(workspaceStoragePath, { withFileTypes: true })

        for (const workspace of workspaces) {
          if (!workspace.isDirectory()) continue

          const workspaceJsonPath = join(workspaceStoragePath, workspace.name, 'workspace.json')
          if (!existsSync(workspaceJsonPath)) continue

          try {
            const workspaceData = JSON.parse(readFileSync(workspaceJsonPath, 'utf8'))
            if (workspaceData.folder) {
              const path = decodeWorkspacePath(workspaceData.folder)
              const name = basename(path)

              // Check if this is the workspace we're looking for
              // Either the basename matches exactly (case-insensitive), or the workspaceName is contained in the path (case-insensitive)
              if (name.toLowerCase() !== workspaceName.toLowerCase() && !path.toLowerCase().includes(workspaceName.toLowerCase())) continue

              const dbPath = join(workspaceStoragePath, workspace.name, 'state.vscdb')
              if (!existsSync(dbPath)) continue

              const workspaceDb = new BetterSqlite3(dbPath, { readonly: true })
              const result = workspaceDb.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get() as
                | undefined
                | { value: string }

              if (result) {
                const parsed = JSON.parse(result.value) as unknown
                if (
                  typeof parsed === 'object' &&
                  parsed !== null &&
                  'allComposers' in parsed &&
                  Array.isArray(parsed.allComposers)
                ) {
                  // Add all composerIds for this workspace to our set
                  for (const composer of parsed.allComposers) {
                    if (typeof composer === 'object' && composer !== null && 'composerId' in composer) {
                      composerIdsForWorkspace.add(composer.composerId as string)
                    }
                  }
                }
              }

              workspaceDb.close()
            }
          } catch (error) {
            console.error(`Error processing workspace ${workspace.name}:`, error)
          }
        }
      }

      spinner.text = `Found ${composerIdsForWorkspace.size} composerIds for workspace "${workspaceName}"`
      await new Promise<void>((r) => {
        setTimeout(r, 50)
      })

      // If we didn't find any composerIds for this workspace, return empty result
      if (composerIdsForWorkspace.size === 0) {
        spinner.info(`No composerIds found for workspace "${workspaceName}"`)
        return []
      }

      spinner.text = 'Connected to database, querying conversations...'
      await new Promise<void>((r) => {
        setTimeout(r, 50)
      })

      // Query for all conversations
      const rows = db.prepare(
        "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' ORDER BY CAST(json_extract(value, '$.createdAt') AS INTEGER) DESC"
      ).all() as { key: string; value: string }[]

      if (rows.length === 0) {
        spinner.info('No conversations found')
        return []
      }

      spinner.text = `Found ${rows.length} conversations, filtering for workspace "${workspaceName}"...`
      await new Promise<void>((r) => {
        setTimeout(r, 50)
      })

      const workspaceConversations: ConversationData[] = []

      // Process conversations and filter for the specified workspace using our composerId mapping
      let processedCount = 0;
      for (const row of rows) {
        try {
          // Update spinner every 10 items to show progress without slowing down too much
          if (processedCount % 10 === 0) {
            spinner.text = `Processed ${processedCount}/${rows.length} conversations...`;
            await new Promise<void>((r) => {
              setTimeout(r, 10)
            });
          }
          processedCount++;

          const parsed = JSON.parse(row.value) as unknown

          if (!isComposerData(parsed)) {
            continue
          }

          // Skip if this composerId is not in our target workspace
          if (!composerIdsForWorkspace.has(parsed.composerId)) {
            continue
          }

          // Skip conversations without messages
          if (!Array.isArray(parsed.conversation) || parsed.conversation.length === 0) {
            continue
          }

          // Process any inline diffs in the conversation
          for (const message of parsed.conversation) {
            processInlineDiffs(message)
          }

          // Get workspace info for this conversation
          const workspaceInfo = { name: workspaceName, path: '' }

          // Get the full path if needed
          if (composerIdsForWorkspace.has(parsed.composerId)) {
            const fullWorkspaceInfo = findWorkspaceInfo(parsed.composerId)
            if (fullWorkspaceInfo.path) {
              workspaceInfo.path = fullWorkspaceInfo.path
            }
          }

          const conversation: ConversationData = {
            composerId: parsed.composerId,
            context: parsed.context as ConversationData['context'],
            conversation: parsed.conversation as ConversationData['conversation'],
            createdAt: parsed.createdAt,
            name: parsed.name,
            richText: parsed.richText,
            text: parsed.text,
            unifiedMode: parsed.unifiedMode,
            workspaceName: workspaceInfo.name,
            workspacePath: workspaceInfo.path,
          }

          workspaceConversations.push(conversation)
        } catch {
          // Skip this conversation if there's an error processing it
          continue
        }
      }

      spinner.succeed(`Found ${workspaceConversations.length} conversations for workspace "${workspaceName}"`)
      return workspaceConversations
    } finally {
      db.close()
    }
  } catch (error) {
    spinner.fail('Error accessing database')
    console.error('Error:', error)
    return []
  }
}

/**
 * Retrieves the latest conversation for a specific workspace.
 * @param workspaceName The name of the workspace to filter by
 * @returns A promise that resolves to the latest conversation for the workspace, or null if none found
 */
export async function getLatestConversationForWorkspace(workspaceName: string): Promise<ConversationData | null> {
  const spinner = ora({
    color: 'cyan',
    spinner: 'dots',
    text: `Finding latest conversation for workspace "${workspaceName}"...`,
  }).start()

  try {
    const dbPath = getCursorDbPath()
    await new Promise<void>((r) => {
      setTimeout(r, 50)
    })

    if (!existsSync(dbPath)) {
      spinner.fail(`Global database not found at: ${dbPath}`)
      return null
    }

    spinner.text = `Opening database connection: ${dbPath}`
    await new Promise<void>((r) => {
      setTimeout(r, 50)
    })

    const db = new BetterSqlite3(dbPath, { readonly: true })

    try {
      // First, build a mapping of composerIds to workspaces for the target workspace
      spinner.text = `Building composerId mapping for workspace "${workspaceName}"...`
      await new Promise<void>((r) => {
        setTimeout(r, 50)
      })

      const composerIdsForWorkspace = new Set<string>()
      const workspaceStoragePath = getWorkspaceStoragePath()
      spinner.text = `Scanning workspaces in: ${workspaceStoragePath}`

      if (existsSync(workspaceStoragePath)) {
        const workspaces = readdirSync(workspaceStoragePath, { withFileTypes: true })
        spinner.text = `Scanning ${workspaces.length} workspace directories...`
        let matchingWorkspaces = 0
        let processedWorkspaces = 0

        for (const workspace of workspaces) {
          if (!workspace.isDirectory()) continue

          const workspaceJsonPath = join(workspaceStoragePath, workspace.name, 'workspace.json')
          if (!existsSync(workspaceJsonPath)) continue

          try {
            const workspaceData = JSON.parse(readFileSync(workspaceJsonPath, 'utf8'))
            if (workspaceData.folder) {
              const path = decodeWorkspacePath(workspaceData.folder)
              const name = basename(path)
              processedWorkspaces++
              spinner.text = `Scanning workspaces: ${processedWorkspaces}/${workspaces.length}`

              // Check if this is the workspace we're looking for
              // Either the basename matches exactly (case-insensitive), or the workspaceName is contained in the path (case-insensitive)
              if (name.toLowerCase() !== workspaceName.toLowerCase() && !path.toLowerCase().includes(workspaceName.toLowerCase())) {
                continue
              }
              matchingWorkspaces++
              spinner.text = `Found matching workspace: ${name}`

              const dbPath = join(workspaceStoragePath, workspace.name, 'state.vscdb')
              if (!existsSync(dbPath)) continue

              const workspaceDb = new BetterSqlite3(dbPath, { readonly: true })
              const result = workspaceDb.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get() as
                | undefined
                | { value: string }

              if (result) {
                const parsed = JSON.parse(result.value) as unknown
                if (
                  typeof parsed === 'object' &&
                  parsed !== null &&
                  'allComposers' in parsed &&
                  Array.isArray(parsed.allComposers)
                ) {
                  // Add all composerIds for this workspace to our set
                  let composersAdded = 0
                  for (const composer of parsed.allComposers) {
                    if (typeof composer === 'object' && composer !== null && 'composerId' in composer) {
                      composerIdsForWorkspace.add(composer.composerId as string)
                      composersAdded++
                    }
                  }
                  if (composersAdded > 0) {
                    spinner.text = `Added ${composersAdded} composers from workspace: ${name}`
                  }
                }
              }

              workspaceDb.close()
            }
          } catch (error) {
            console.error(`Error processing workspace ${workspace.name}:`, error)
          }
        }
      }

      spinner.text = `Found ${composerIdsForWorkspace.size} composerIds for workspace "${workspaceName}"`
      await new Promise<void>((r) => {
        setTimeout(r, 50)
      })

      // If we didn't find any composerIds for this workspace, return null
      if (composerIdsForWorkspace.size === 0) {
        spinner.info(`No composerIds found for workspace "${workspaceName}"`)
        return null
      }

      spinner.text = 'Connected to database, querying conversations...'
      await new Promise<void>((r) => {
        setTimeout(r, 50)
      })

      // Query for the 100 most recent conversations to increase chances of finding workspace-specific ones
      const rows = db.prepare(
        "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' ORDER BY CAST(json_extract(value, '$.createdAt') AS INTEGER) DESC LIMIT 100"
      ).all() as { key: string; value: string }[]

      if (rows.length === 0) {
        spinner.info('No conversations found')
        return null
      }

      spinner.text = `Found ${rows.length} recent conversations, searching for workspace "${workspaceName}"...`
      await new Promise<void>((r) => {
        setTimeout(r, 50)
      })

      // Process conversations one by one until we find a suitable one for the workspace
      let processedCount = 0;
      let matchedCount = 0;
      for (const row of rows) {
        try {
          // Update spinner every 5 items to show progress without slowing down too much
          if (processedCount % 5 === 0) {
            spinner.text = `Checking conversation ${processedCount + 1}/${rows.length} for workspace "${workspaceName}"...`;
            await new Promise<void>((r) => {
              setTimeout(r, 10)
            });
          }
          processedCount++;

          const parsed = JSON.parse(row.value) as unknown

          if (!isComposerData(parsed)) {
            continue
          }

          // Skip if this composerId is not in our target workspace
          if (!composerIdsForWorkspace.has(parsed.composerId)) {
            continue
          }

          matchedCount++;
          spinner.text = `Found ${matchedCount} matching conversations for workspace "${workspaceName}"`

          // Skip conversations without messages
          if (!Array.isArray(parsed.conversation) || parsed.conversation.length === 0) {
            continue
          }

          // Process any inline diffs in the conversation
          for (const message of parsed.conversation) {
            processInlineDiffs(message)
          }

          // Get workspace info for this conversation
          const workspaceInfo = { name: workspaceName, path: '' }

          // Get the full path if needed
          if (composerIdsForWorkspace.has(parsed.composerId)) {
            const fullWorkspaceInfo = findWorkspaceInfo(parsed.composerId)
            if (fullWorkspaceInfo.path) {
              workspaceInfo.path = fullWorkspaceInfo.path
            }
          }

          const conversation: ConversationData = {
            composerId: parsed.composerId,
            context: parsed.context as ConversationData['context'],
            conversation: parsed.conversation as ConversationData['conversation'],
            createdAt: parsed.createdAt,
            name: parsed.name,
            richText: parsed.richText,
            text: parsed.text,
            unifiedMode: parsed.unifiedMode,
            workspaceName: workspaceInfo.name,
            workspacePath: workspaceInfo.path,
          }

          spinner.succeed(`Found conversation for workspace "${workspaceName}"`)
          return conversation
        } catch {
          // Skip this conversation if there's an error processing it
          continue
        }
      }

      // If we get here, we didn't find any suitable conversations for the workspace
      spinner.info(`No conversations found for workspace "${workspaceName}"`)
      return null
    } finally {
      db.close()
    }
  } catch (error) {
    spinner.fail('Error accessing database')
    console.error('Error:', error)
    return null
  }
}

/**
 * Retrieves the latest conversation with content.
 * @returns A promise that resolves to the latest conversation, or null if none found
 */
export async function getLatestConversation(): Promise<ConversationData | null> {
  const spinner = ora({
    color: 'cyan',
    spinner: 'dots',
    text: 'Finding latest conversation with content...',
  }).start()

  try {
    const dbPath = getCursorDbPath()
    await new Promise<void>((r) => {
      setTimeout(r, 50)
    })

    if (!existsSync(dbPath)) {
      spinner.fail(`Global database not found at: ${dbPath}`)
      return null
    }

    spinner.text = `Opening database connection: ${dbPath}`
    await new Promise<void>((r) => {
      setTimeout(r, 50)
    })

    const db = new BetterSqlite3(dbPath, { readonly: true })

    try {
      spinner.text = 'Connected to database, querying conversations...'
      await new Promise<void>((r) => {
        setTimeout(r, 50)
      })

      // Query for the 20 most recent conversations
      const rows = db.prepare(
        "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' ORDER BY CAST(json_extract(value, '$.createdAt') AS INTEGER) DESC LIMIT 20"
      ).all() as { key: string; value: string }[]

      if (rows.length === 0) {
        spinner.info('No conversations found')
        return null
      }

      spinner.text = `Found ${rows.length} recent conversations, searching for one with content...`
      await new Promise<void>((r) => {
        setTimeout(r, 50)
      })

      // Process conversations one by one until we find a suitable one
      let processedCount = 0;
      for (const row of rows) {
        try {
          // Update spinner every 5 items to show progress without slowing down too much
          if (processedCount % 5 === 0) {
            spinner.text = `Checking conversation ${processedCount + 1}/${rows.length} for content...`;
            await new Promise<void>((r) => {
              setTimeout(r, 10)
            });
          }
          processedCount++;

          const parsed = JSON.parse(row.value) as unknown

          if (!isComposerData(parsed)) {
            continue
          }

          // Skip conversations without messages
          if (!Array.isArray(parsed.conversation) || parsed.conversation.length === 0) {
            continue
          }

          // Skip unnamed conversations without assistant messages
          const hasAssistant = parsed.conversation.some((message: any) =>
            message &&
            (
              (typeof message.role === 'string' && message.role === 'Assistant') ||
              message.type === '2' ||
              message.type === 2
            )
          )

          if ((!parsed.name || parsed.name === 'Unnamed Conversation') && !hasAssistant) {
            continue
          }

          // Process any inline diffs in the conversation
          for (const message of parsed.conversation) {
            processInlineDiffs(message)
          }

          // Get workspace info for this conversation
          const workspaceInfo = findWorkspaceInfo(parsed.composerId)

          const conversation: ConversationData = {
            composerId: parsed.composerId,
            context: parsed.context as ConversationData['context'],
            conversation: parsed.conversation as ConversationData['conversation'],
            createdAt: parsed.createdAt,
            name: parsed.name,
            richText: parsed.richText,
            text: parsed.text,
            unifiedMode: parsed.unifiedMode,
            workspaceName: workspaceInfo.name,
            workspacePath: workspaceInfo.path,
          }

          spinner.succeed('Found conversation with content')
          return conversation
        } catch {
          // Skip this conversation if there's an error processing it
          continue
        }
      }

      // If we get here, we didn't find any suitable conversations
      // Fall back to the first conversation
      try {
        const firstRow = rows[0]
        const parsed = JSON.parse(firstRow.value) as unknown

        if (!isComposerData(parsed)) {
          spinner.fail('No valid conversations found')
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

        spinner.info('No conversations with content found, returning most recent conversation')

        return {
          composerId: parsed.composerId,
          context: parsed.context as ConversationData['context'],
          conversation: parsed.conversation as ConversationData['conversation'],
          createdAt: parsed.createdAt,
          name: parsed.name,
          richText: parsed.richText,
          text: parsed.text,
          unifiedMode: parsed.unifiedMode,
          workspaceName: workspaceInfo.name,
          workspacePath: workspaceInfo.path,
        }
      } catch (error) {
        spinner.fail('Error processing conversation')
        console.error('Error:', error)
        return null
      }
    } finally {
      db.close()
    }
  } catch (error) {
    spinner.fail('Error accessing database')
    console.error('Error:', error)
    return null
  }
}
