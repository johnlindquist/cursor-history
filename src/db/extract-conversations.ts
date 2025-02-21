import BetterSqlite3 from 'better-sqlite3'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {platform} from 'node:os'

import type {ConversationData, Message} from '../types.js'

function getCursorDbPath(): string {
  const os = platform()
  const home = process.env.HOME || process.env.USERPROFILE || ''

  switch (os) {
    case 'darwin': // macOS
      return join(home, 'Library/Application Support/Cursor/User/globalStorage/state.vscdb')
    case 'win32': // Windows
      return join(process.env.APPDATA || join(home, 'AppData/Roaming'), 'Cursor/User/globalStorage/state.vscdb')
    case 'linux': // Linux
      return join(home, '.config/Cursor/User/globalStorage/state.vscdb')
    default:
      throw new Error(`Unsupported platform: ${os}`)
  }
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
          conversations.push({
            composerId: data.composerId,
            context: data.context,
            conversation,
            createdAt: data.createdAt,
            richText: data.richText,
            text: data.text,
          })
        }
      } catch (error) {
        console.log(`Failed to parse conversation data: ${error}`)
      }
    }

    if (conversations.length > 0) {
      console.log(`Found ${conversations.length} conversations with content`)
      return conversations.sort((a, b) => b.createdAt - a.createdAt)
    } else {
      console.log('No conversations with content found')
      return []
    }
  } catch (error) {
    console.error('Error processing database:', error)
    return []
  } finally {
    db?.close()
  }
}
