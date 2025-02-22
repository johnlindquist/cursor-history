import Database from 'better-sqlite3'
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {platform} from 'node:os'
import {basename, join} from 'node:path'

import type {CodeBlockAnalysis, ConversationAnalysis, Message, MessageAnalysisResult} from './types.js'

interface ConversationMetadata {
  createdAt: number
  hasEmptyMessages: boolean
  id: string
  messages: Message[]
  missingCodeBlocks: boolean
  missingMetadata: boolean
  mode: string
  name: string
  stats: {
    emptyMessages: number
    messagesWithAttachments: number
    messagesWithCode: number
    messagesWithTools: number
    totalMessages: number
  }
  workspaceName: string
  workspacePath: string
}

interface CodeBlock {
  [key: string]: any
  code: string
  end?: number
  file?: string
  language?: string
  start?: number
}

interface UriObject {
  $mid: number
  external: string
  fsPath: string
  path: string
  scheme: string
}

function getWorkspaceStoragePath(): string {
  const os = platform()
  const home = process.env.HOME || process.env.USERPROFILE || ''

  switch (os) {
    case 'darwin': {
      return join(home, 'Library/Application Support/Cursor/User/workspaceStorage')
    }

    case 'linux': {
      return join(home, '.config/Cursor/User/workspaceStorage')
    }

    case 'win32': {
      return join(process.env.APPDATA || join(home, 'AppData/Roaming'), 'Cursor/User/workspaceStorage')
    }

    default: {
      throw new Error(`Unsupported platform: ${os}`)
    }
  }
}

function decodeWorkspacePath(uri: string | UriObject): string {
  try {
    if (typeof uri === 'string') {
      return uri.replace(/^file:\/\//, '')
    }

    return uri.fsPath
  } catch (error) {
    console.error('Failed to decode workspace path:', error)
    return typeof uri === 'string' ? uri : uri.fsPath
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

function findRecentConversations(limit = 5): Array<{composerId: string; workspaceId: string}> {
  const conversations: Array<{composerId: string; createdAt: number; workspaceId: string}> = []

  const workspaceIds = readdirSync(getWorkspaceStoragePath()).filter(
    (id) => !id.startsWith('.') && existsSync(join(getWorkspaceStoragePath(), id, 'state.vscdb')),
  )

  for (const workspaceId of workspaceIds) {
    const dbPath = join(getWorkspaceStoragePath(), workspaceId, 'state.vscdb')
    let db: Database.Database | null = null

    try {
      db = new Database(dbPath, {fileMustExist: true, readonly: true})
      const rows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as {
        key: string
        value: string
      }[]

      for (const row of rows) {
        try {
          const data = JSON.parse(row.value)
          if (data.conversation?.length > 0) {
            conversations.push({
              composerId: data.composerId,
              createdAt: data.createdAt,
              workspaceId,
            })
          }
        } catch (error) {
          console.error(`Error parsing conversation data in workspace ${workspaceId}:`, error)
        }
      }
    } catch (error) {
      console.error(`Error reading workspace ${workspaceId}:`, error)
    } finally {
      db?.close()
    }
  }

  return conversations
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(({composerId, workspaceId}) => ({composerId, workspaceId}))
}

function analyzeConversation(workspaceId: string, composerId: string): ConversationMetadata | null {
  const dbPath = join(getWorkspaceStoragePath(), workspaceId, 'state.vscdb')
  const workspaceInfo = getWorkspaceInfo(workspaceId)

  if (!workspaceInfo) return null

  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, {fileMustExist: true, readonly: true})

    // Get composer data from cursorDiskKV
    const composerData = db
      .prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
      .get(`composerData:${composerId}`) as undefined | {value: string}

    if (!composerData) return null

    const data = JSON.parse(composerData.value)
    if (!data.conversation) return null

    const stats = {
      emptyMessages: 0,
      messagesWithAttachments: 0,
      messagesWithCode: 0,
      messagesWithTools: 0,
      totalMessages: 0,
    }

    let hasEmptyMessages = false
    let missingCodeBlocks = false
    let missingMetadata = false

    // Analyze each message
    const messages = data.conversation.map((msg: Message) => {
      const analysis = analyzeMessage(msg)
      stats.totalMessages++

      if (analysis.isEmpty) {
        hasEmptyMessages = true
        stats.emptyMessages++
      }

      if (analysis.hasCode) stats.messagesWithCode++
      if (analysis.hasTools) stats.messagesWithTools++
      if (analysis.hasAttachments) stats.messagesWithAttachments++

      // Check for potential missing data
      if (msg.role === 'assistant' && msg.content.includes('```') && !analysis.hasCode) {
        missingCodeBlocks = true
      }

      if (!msg.metadata) {
        missingMetadata = true
      }

      return msg
    })

    return {
      createdAt: data.createdAt,
      hasEmptyMessages,
      id: composerId,
      messages,
      missingCodeBlocks,
      missingMetadata,
      mode: data.unifiedMode,
      name: data.name || 'Unnamed',
      stats,
      workspaceName: workspaceInfo.name,
      workspacePath: workspaceInfo.path,
    }
  } catch (error) {
    console.error(`Error analyzing conversation in workspace ${workspaceId}:`, error)
    return null
  } finally {
    db?.close()
  }
}

function getCursorDbPath(): string {
  const os = platform()
  const home = process.env.HOME || process.env.USERPROFILE || ''

  switch (os) {
    case 'darwin': {
      return join(home, 'Library/Application Support/Cursor/User/globalStorage/state.vscdb')
    }

    case 'linux': {
      return join(home, '.config/Cursor/User/globalStorage/state.vscdb')
    }

    case 'win32': {
      return join(process.env.APPDATA || join(home, 'AppData/Roaming'), 'Cursor/User/globalStorage/state.vscdb')
    }

    default: {
      throw new Error(`Unsupported platform: ${os}`)
    }
  }
}

function determineContentType(content: string | undefined, language: string | undefined): 'code' | 'text' | 'unknown' {
  if (!content) return 'unknown'

  // Known code languages
  const codeLanguages = new Set([
    'bash',
    'c',
    'cpp',
    'css',
    'go',
    'graphql',
    'html',
    'java',
    'javascript',
    'json',
    'jsx',
    'markdown',
    'python',
    'rust',
    'scss',
    'shell',
    'sql',
    'tsx',
    'typescript',
    'yaml',
    'zsh',
  ])

  // Code patterns
  const codePatterns = [
    // Language markers
    /```\w+/,
    // Common programming constructs
    /\b(function|class|const|let|var|import|export|return|if|for|while)\b/,
    // Method/function calls
    /\.\w+\([^)]*\)/,
    // JSX/TSX patterns
    /<[A-Z][A-Za-z]+[^>]*>/,
    // Common code symbols
    /[{}\[\]()=>;]/,
    // Import/export statements
    /\b(import|export)\b.*?['"][^'"]+['"]/,
    // Decorators
    /@\w+/,
    // Type definitions
    /\b(type|interface)\b.*?{/,
  ]

  // Text patterns
  const textPatterns = [
    // Natural language sentences
    /^[A-Z][^.!?]*[.!?]$/m,
    // List items
    /^[-*]\s+\w+/m,
    // Numbered lists
    /^\d+\.\s+\w+/m,
    // Common English words
    /\b(the|and|or|but|because|therefore|however)\b/i,
  ]

  // Check language first
  if (language && codeLanguages.has(language.toLowerCase())) {
    return 'code'
  }

  // Count matches for each type
  const codeMatches = codePatterns.filter((pattern) => pattern.test(content)).length
  const textMatches = textPatterns.filter((pattern) => pattern.test(content)).length

  // Analyze line structure
  const lines = content.split('\n')
  const avgLineLength = content.length / lines.length
  const hasConsistentIndentation = lines.some((line) => /^\s{2,}/.test(line))

  // Scoring system
  let score = 0
  score += codeMatches * 2
  score -= textMatches
  score += hasConsistentIndentation ? 2 : 0
  score += avgLineLength < 50 ? 1 : -1 // Code lines tend to be shorter

  // Additional code indicators
  if (content.includes('```')) score += 3
  if (content.includes('`')) score += 1
  if (/[{}\[\]();]/.test(content)) score += 2

  // Make the decision
  if (score >= 3) return 'code'
  if (score <= -2) return 'text'
  return 'unknown'
}

function analyzeCodeBlock(block: any): CodeBlockAnalysis {
  if (typeof block === 'string') {
    try {
      block = JSON.parse(block)
    } catch {
      return {
        content: undefined,
        contentAnalysis: {
          hasClasses: false,
          hasFunctions: false,
          hasImports: false,
          hasJSX: false,
          hasMarkdown: false,
          indentationLevel: 0,
          lineCount: 0,
        },
        contentLength: 0,
        fileContext: undefined,
        hasContent: false,
        isGenerating: false,
        language: undefined,
        type: 'unknown',
      }
    }
  }

  // Extract all possible content fields
  const content = block?.content || block?.code || ''
  const language = block?.languageId || block?.language || 'unknown'

  // Analyze content structure
  const type = determineContentType(content, language)

  let fileContext
  if (block.uri) {
    fileContext = {
      lineEnd: typeof block.end === 'number' ? block.end : undefined,
      lineStart: typeof block.start === 'number' ? block.start : undefined,
      path: decodeWorkspacePath(block.uri),
    }
  }

  // Enhanced content analysis
  const contentAnalysis = {
    hasClasses: /\bclass\b/.test(content),
    hasFunctions: /\b(function|=>)\b/.test(content),
    hasImports: /\b(import|require)\b/.test(content),
    hasJSX: /<[A-Z][A-Za-z]+[^>]*>/.test(content),
    hasMarkdown: content.includes('```') || content.includes('#') || content.includes('*'),
    indentationLevel: content.match(/^(\s+)/)?.[1].length || 0,
    lineCount: content ? content.split('\n').length : 0,
  }

  // Log detailed analysis for debugging
  if (content) {
    console.log('\nCode Block Analysis:')
    console.log('Content Length:', content.length)
    console.log('Language:', language)
    console.log('Type:', type)
    console.log('Content Analysis:', contentAnalysis)
    console.log('Content Preview:', content.slice(0, 100))
    if (fileContext) {
      console.log('File Context:', fileContext)
    }
  }

  return {
    content: content || undefined,
    contentAnalysis,
    contentLength: content?.length || 0,
    fileContext,
    hasContent: Boolean(content),
    isGenerating: Boolean(block?.isGenerating),
    language: language || undefined,
    type,
  }
}

function analyzeMessage(message: Message): MessageAnalysisResult {
  const isEmpty = !message.content || !message.content.trim()
  const hasCode = Array.isArray(message.codeBlocks) && message.codeBlocks.length > 0
  const hasTools = Array.isArray(message.tools) && message.tools.length > 0
  const hasAttachments = Array.isArray(message.attachments) && message.attachments.length > 0
  const hasMetadata = Boolean(message.metadata)

  const codeBlocks = message?.codeBlocks || []
  const codeBlockAnalyses = codeBlocks.map(analyzeCodeBlock)

  let metadataDetails
  let recoveredContent

  if (hasMetadata && message.metadata) {
    const md = message.metadata
    const allKeys = Object.keys(md)

    metadataDetails = {
      additionalKeys: allKeys.filter((k) => !k.startsWith('cursorContext')),
      hasContextFiles: Array.isArray(md.cursorContextFiles) && md.cursorContextFiles.length > 0,
      hasContextLines: Array.isArray(md.cursorContextLines) && md.cursorContextLines.length > 0,
      hasFileType: Boolean(md.cursorContextFileType),
      hasGitInfo: Boolean(md.cursorContextGitBranch || md.cursorContextGitRepo),
      hasLanguage: Boolean(md.cursorContextLanguage),
      hasLineRange: typeof md.cursorContextStartLine === 'number' && typeof md.cursorContextEndLine === 'number',
      hasProjectInfo: Boolean(md.cursorContextProjectRoot),
      hasSelectedCode: Boolean(md.cursorContextSelectedCode),
      hasSelectedFile: Boolean(md.cursorContextSelectedFile),
    }

    recoveredContent = {
      fromAttachments: undefined,
      fromContextLines: undefined,
      fromSelectedCode: undefined,
    } as {
      fromAttachments?: string
      fromContextLines?: string
      fromSelectedCode?: string
    }

    if (metadataDetails.hasContextLines && md.cursorContextLines) {
      recoveredContent.fromContextLines = md.cursorContextLines.join('\n')
    }

    if (metadataDetails.hasSelectedCode) {
      recoveredContent.fromSelectedCode = md.cursorContextSelectedCode
    }

    if (hasAttachments && message.attachments) {
      recoveredContent.fromAttachments = message.attachments
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)))
        .join('\n')
    }
  }

  return {
    codeBlocks: codeBlockAnalyses,
    content: message?.content || '',
    contentLength: (message?.content || '').length,
    hasAttachments,
    hasCode,
    hasMetadata,
    hasTools,
    isEmpty,
    metadataDetails,
    recoveredContent,
    role: message?.role || 'unknown',
    timestamp: message?.timestamp || 0,
  }
}

interface ContentStats {
  byFeatures: {
    hasClasses: number
    hasFunctions: number
    hasImports: number
    hasJSX: number
    hasMarkdown: number
  }
  byLanguage: Record<string, number>
  byType: {
    code: number
    text: number
    unknown: number
  }
  contentLengths: {
    avg: number
    max: number
    min: number
  }
  totalBlocks: number
  withContent: number
}

function extractContentStats(conversations: ConversationAnalysis[]): ContentStats {
  const stats: ContentStats = {
    byFeatures: {
      hasClasses: 0,
      hasFunctions: 0,
      hasImports: 0,
      hasJSX: 0,
      hasMarkdown: 0,
    },
    byLanguage: {},
    byType: {code: 0, text: 0, unknown: 0},
    contentLengths: {avg: 0, max: 0, min: Infinity},
    totalBlocks: 0,
    withContent: 0,
  }

  let totalLength = 0
  let blockCount = 0

  for (const conv of conversations) {
    for (const msg of conv.messages) {
      for (const block of msg.codeBlocks) {
        blockCount++
        if (block.hasContent) {
          stats.withContent++
          const length = block.contentLength || 0
          totalLength += length
          stats.contentLengths.min = Math.min(stats.contentLengths.min, length)
          stats.contentLengths.max = Math.max(stats.contentLengths.max, length)
        }

        if (block.type === 'code' || block.type === 'text' || block.type === 'unknown') {
          stats.byType[block.type]++
        }

        if (block.language) {
          stats.byLanguage[block.language] = (stats.byLanguage[block.language] || 0) + 1
        }

        if (block.contentAnalysis) {
          if (block.contentAnalysis.hasImports) stats.byFeatures.hasImports++
          if (block.contentAnalysis.hasFunctions) stats.byFeatures.hasFunctions++
          if (block.contentAnalysis.hasClasses) stats.byFeatures.hasClasses++
          if (block.contentAnalysis.hasJSX) stats.byFeatures.hasJSX++
          if (block.contentAnalysis.hasMarkdown) stats.byFeatures.hasMarkdown++
        }
      }
    }
  }

  stats.totalBlocks = blockCount
  stats.contentLengths.avg = blockCount > 0 ? totalLength / blockCount : 0

  // Handle edge case where no blocks have content
  if (stats.contentLengths.min === Infinity) {
    stats.contentLengths.min = 0
  }

  return stats
}

function printContentStats(stats: ContentStats) {
  console.log('\nDetailed Content Analysis:')
  console.log('Total Blocks:', stats.totalBlocks)
  console.log('Blocks with Content:', stats.withContent)

  console.log('\nBy Type:')
  for (const [type, count] of Object.entries(stats.byType)) {
    const percentage = ((count / stats.totalBlocks) * 100).toFixed(1)
    console.log(`- ${type}: ${count} (${percentage}%)`)
  }

  console.log('\nBy Language:')
  for (const [lang, count] of Object.entries(stats.byLanguage).sort(([, a], [, b]) => b - a)) {
    const percentage = ((count / stats.totalBlocks) * 100).toFixed(1)
    console.log(`- ${lang}: ${count} (${percentage}%)`)
  }

  console.log('\nContent Features:')
  for (const [feature, count] of Object.entries(stats.byFeatures)) {
    const percentage = ((count / stats.totalBlocks) * 100).toFixed(1)
    console.log(`- ${feature}: ${count} (${percentage}%)`)
  }

  console.log('\nContent Lengths:')
  console.log('- Min:', stats.contentLengths.min)
  console.log('- Max:', stats.contentLengths.max)
  console.log('- Average:', Math.round(stats.contentLengths.avg))
}

async function main() {
  const globalDbPath = getCursorDbPath()
  console.log('Global database path:', globalDbPath)

  if (!existsSync(globalDbPath)) {
    console.error('Global database does not exist!')
    return
  }

  let db: Database.Database | null = null
  try {
    db = new Database(globalDbPath, {readonly: true})

    // List all tables
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    console.log('\nTables in database:', tables)

    // Get all conversations and sort by creation date
    const items = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as {
      key: string
      value: string
    }[]

    console.log('\nFound composer data keys:', items.length)

    // Parse all conversations and analyze their structure
    const conversations = items
      .map((item): ConversationAnalysis | null => {
        try {
          const data = JSON.parse(item.value)
          const messages = Array.isArray(data.conversation) ? data.conversation : []

          const messageAnalysis = messages.map((msg: Message): MessageAnalysisResult => {
            const codeBlocks = Array.isArray(msg?.codeBlocks) ? msg.codeBlocks : []
            const codeBlockAnalyses = codeBlocks.map(analyzeCodeBlock)

            return {
              codeBlocks: codeBlockAnalyses,
              content: msg?.content || '',
              contentLength: (msg?.content || '').length,
              hasAttachments: Array.isArray(msg?.attachments) && msg.attachments.length > 0,
              hasCode: codeBlocks.length > 0,
              hasMetadata: Boolean(msg?.metadata),
              hasTools: Array.isArray(msg?.tools) && msg.tools.length > 0,
              isEmpty: !msg?.content?.trim(),
              metadataDetails: msg?.metadata
                ? {
                    additionalKeys: Object.keys(msg.metadata).filter((k) => !k.startsWith('cursorContext')),
                    hasContextFiles:
                      Array.isArray(msg.metadata.cursorContextFiles) && msg.metadata.cursorContextFiles.length > 0,
                    hasContextLines:
                      Array.isArray(msg.metadata.cursorContextLines) && msg.metadata.cursorContextLines.length > 0,
                    hasFileType: Boolean(msg.metadata.cursorContextFileType),
                    hasGitInfo: Boolean(msg.metadata.cursorContextGitBranch || msg.metadata.cursorContextGitRepo),
                    hasLanguage: Boolean(msg.metadata.cursorContextLanguage),
                    hasLineRange:
                      typeof msg.metadata.cursorContextStartLine === 'number' &&
                      typeof msg.metadata.cursorContextEndLine === 'number',
                    hasProjectInfo: Boolean(msg.metadata.cursorContextProjectRoot),
                    hasSelectedCode: Boolean(msg.metadata.cursorContextSelectedCode),
                    hasSelectedFile: Boolean(msg.metadata.cursorContextSelectedFile),
                  }
                : undefined,
              recoveredContent: msg?.metadata
                ? {
                    fromAttachments: msg.attachments
                      ?.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)))
                      .join('\n'),
                    fromContextLines: msg.metadata.cursorContextLines?.join('\n'),
                    fromSelectedCode: msg.metadata.cursorContextSelectedCode,
                  }
                : undefined,
              role: msg?.role || 'unknown',
              timestamp: msg?.timestamp || 0,
            }
          })

          return {
            contentAnalysis: {
              contentTypes: {
                code: messageAnalysis.reduce(
                  (sum: number, m: MessageAnalysisResult) =>
                    sum + m.codeBlocks.filter((b: CodeBlockAnalysis) => b.type === 'code').length,
                  0,
                ),
                text: messageAnalysis.reduce(
                  (sum: number, m: MessageAnalysisResult) =>
                    sum + m.codeBlocks.filter((b: CodeBlockAnalysis) => b.type === 'text').length,
                  0,
                ),
                unknown: messageAnalysis.reduce(
                  (sum: number, m: MessageAnalysisResult) =>
                    sum + m.codeBlocks.filter((b: CodeBlockAnalysis) => b.type === 'unknown').length,
                  0,
                ),
              },
              fileReferences: messageAnalysis.reduce(
                (acc: Record<string, {count: number; hasLineRanges: boolean}>, m: MessageAnalysisResult) => {
                  for (const b of m.codeBlocks) {
                    if (b.fileContext?.path) {
                      const {path} = b.fileContext
                      if (!acc[path]) {
                        acc[path] = {count: 0, hasLineRanges: false}
                      }

                      acc[path].count++
                      acc[path].hasLineRanges =
                        acc[path].hasLineRanges ||
                        (b.fileContext.lineStart !== undefined && b.fileContext.lineEnd !== undefined)
                    }
                  }

                  return acc
                },
                {},
              ),
              generatingBlocks: messageAnalysis.reduce(
                (sum: number, m: MessageAnalysisResult) =>
                  sum + m.codeBlocks.filter((b: CodeBlockAnalysis) => b.isGenerating).length,
                0,
              ),
              languages: [...new Set(conversations.flatMap((c) => c.contentAnalysis.languages))].filter(
                (l): l is string => typeof l === 'string',
              ),
              messagesWithContent: messageAnalysis.filter((m: MessageAnalysisResult) => !m.isEmpty).length,
              totalCodeBlocks: messageAnalysis.reduce(
                (sum: number, m: MessageAnalysisResult) => sum + m.codeBlocks.length,
                0,
              ),
            },
            createdAt: data.createdAt || 0,
            id: data.composerId || '',
            key: item.key,
            messageCount: messages.length,
            messages: messageAnalysis,
            mode: data.unifiedMode || 'unknown',
            name: data.name || 'Unnamed',
          }
        } catch (error) {
          console.error(`Error parsing conversation data for key ${item.key}:`, error)
          return null
        }
      })
      .filter((c): c is ConversationAnalysis => c !== null)
      .sort((a, b) => b.createdAt - a.createdAt)

    // Print overall statistics
    console.log('\nOverall Statistics:')
    console.log(`Total Conversations: ${conversations.length}`)
    console.log(
      `Conversations with Message Content: ${
        conversations.filter((c) => c.contentAnalysis.messagesWithContent > 0).length
      }`,
    )
    console.log(
      `Conversations with Code Blocks: ${conversations.filter((c) => c.contentAnalysis.totalCodeBlocks > 0).length}`,
    )
    console.log(`Total Code Blocks: ${conversations.reduce((sum, c) => sum + c.contentAnalysis.totalCodeBlocks, 0)}`)

    const allLanguages = [...new Set(conversations.flatMap((c) => c.contentAnalysis.languages))]
    console.log('\nLanguages Found:', allLanguages)

    // Analyze recent conversations in detail
    const samplesToAnalyze = 5
    console.log(`\nAnalyzing ${samplesToAnalyze} Recent Conversations:`)

    for (let i = 0; i < Math.min(samplesToAnalyze, conversations.length); i++) {
      const conversation = conversations[i]
      console.log(`\nConversation ${i + 1}:`)
      console.log(`Name: ${conversation.name}`)
      console.log(`Created: ${new Date(conversation.createdAt).toLocaleString()}`)
      console.log(`Mode: ${conversation.mode}`)
      console.log(`Messages: ${conversation.messageCount}`)
      console.log(`Messages with Content: ${conversation.contentAnalysis.messagesWithContent}`)
      console.log(`Total Code Blocks: ${conversation.contentAnalysis.totalCodeBlocks}`)

      if (conversation.contentAnalysis.languages.length > 0) {
        console.log('Languages:', conversation.contentAnalysis.languages)
      }

      // Show sample messages with content
      for (const msg of conversation.messages) {
        if (!msg.isEmpty || msg.codeBlocks.length > 0) {
          console.log('\nSample Message:')
          if (!msg.isEmpty) {
            console.log('Message Content:', msg.content.slice(0, 200) + '...')
          }

          for (const [i, block] of msg.codeBlocks.entries()) {
            if (block.hasContent) {
              console.log(`\nCode Block ${i + 1}:`)
              console.log('Content:', block.content?.slice(0, 200) + '...')
              if (block.language) {
                console.log('Language:', block.language)
              }

              if (block.fileContext) {
                console.log('File:', block.fileContext.path)
              }
            }
          }

          break
        }
      }
    }

    // Generate and print content statistics
    const contentStats = extractContentStats(conversations)
    printContentStats(contentStats)
  } catch (error) {
    console.error('Error inspecting database:', error)
  } finally {
    db?.close()
  }
}

await main().catch(console.error)
