import Database from 'better-sqlite3'
import {existsSync} from 'node:fs'
import {platform} from 'node:os'
import {join} from 'node:path'

import type {CodeBlockAnalysis, ConversationAnalysis, Message, MessageAnalysisResult} from './types.js'

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
    /[{}[\]()=>;]/,
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
  if (/[{}[\]();]/.test(content)) score += 2

  // Make the decision
  if (score >= 3) return 'code'
  if (score <= -2) return 'text'
  return 'unknown'
}

function analyzeMessage(message: Message): MessageAnalysisResult {
  const codeBlocks: CodeBlockAnalysis[] = []
  const blocks: Array<{analysis: CodeBlockAnalysis; block: Partial<CodeBlock>}> = []

  if (message.codeBlocks) {
    for (const block of message.codeBlocks) {
      const analysis = analyzeCodeBlock(block)
      codeBlocks.push(analysis)
      blocks.push({analysis, block})
    }
  }

  let totalLength = 0
  let blockCount = 0

  for (const block of blocks) {
    if (block.block.content) {
      const {length} = block.block.content
      totalLength += length
      blockCount++
    }
  }

  const avgLength = blockCount > 0 ? totalLength / blockCount : 0

  return {
    blocks,
    codeBlocks,
    content: message.content || '',
    contentLength: message.content?.length || 0,
    hasAttachments: Array.isArray(message.attachments) && message.attachments.length > 0,
    hasCode: codeBlocks.length > 0,
    hasMetadata: Boolean(message.metadata),
    hasTools: Array.isArray(message.tools) && message.tools.length > 0,
    isEmpty: !message.content?.trim(),
    metadataDetails: message.metadata
      ? {
          additionalKeys: Object.keys(message.metadata).filter((key) => !key.startsWith('cursorContext')),
          hasContextFiles: Boolean(message.metadata.cursorContextFiles),
          hasContextLines: Boolean(message.metadata.cursorContextLines),
          hasFileType: Boolean(message.metadata.cursorContextFileType),
          hasGitInfo: Boolean(message.metadata.cursorContextGitBranch || message.metadata.cursorContextGitRepo),
          hasLanguage: Boolean(message.metadata.cursorContextLanguage),
          hasLineRange: Boolean(
            message.metadata.cursorContextStartLine !== undefined &&
              message.metadata.cursorContextEndLine !== undefined,
          ),
          hasProjectInfo: Boolean(message.metadata.cursorContextProjectRoot),
          hasSelectedCode: Boolean(message.metadata.cursorContextSelectedCode),
          hasSelectedFile: Boolean(message.metadata.cursorContextSelectedFile),
        }
      : undefined,
    role: message.role || 'unknown',
    stats: {
      avgBlockLength: avgLength,
      totalBlocks: blockCount,
      totalLength,
    },
    timestamp: message.timestamp || 0,
  }
}

function analyzeCodeBlock(block: Partial<CodeBlock> | string): CodeBlockAnalysis {
  let parsedBlock: Partial<CodeBlock>
  if (typeof block === 'string') {
    try {
      parsedBlock = JSON.parse(block)
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
  } else {
    parsedBlock = block
  }

  const content = (parsedBlock.content || parsedBlock.code || '') as string
  const language = parsedBlock.language || 'unknown'
  const type = determineContentType(content, language)

  let fileContext
  if (parsedBlock.uri) {
    fileContext = {
      lineEnd: typeof parsedBlock.end === 'number' ? parsedBlock.end : undefined,
      lineStart: typeof parsedBlock.start === 'number' ? parsedBlock.start : undefined,
      path: typeof parsedBlock.uri === 'string' ? parsedBlock.uri : parsedBlock.uri.path,
    }
  }

  const contentAnalysis = {
    hasClasses: /\bclass\b/.test(content),
    hasFunctions: /\b(function|=>)\b/.test(content),
    hasImports: /\b(import|require)\b/.test(content),
    hasJSX: /<[A-Z][A-Za-z]+[^>]*>/.test(content),
    hasMarkdown: content.includes('```') || content.includes('#') || content.includes('*'),
    indentationLevel: content.match(/^(\s+)/)?.[1]?.length || 0,
    lineCount: content ? content.split('\n').length : 0,
  }

  return {
    content,
    contentAnalysis,
    contentLength: content?.length || 0,
    fileContext,
    hasContent: Boolean(content),
    isGenerating: Boolean(parsedBlock.isGenerating),
    language: language || undefined,
    type,
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
    byType: {
      code: 0,
      text: 0,
      unknown: 0,
    },
    contentLengths: {
      avg: 0,
      max: 0,
      min: Infinity,
    },
    totalBlocks: 0,
    withContent: 0,
  }

  let totalLength = 0
  let blockCount = 0

  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      if (message.codeBlocks) {
        stats.totalBlocks += message.codeBlocks.length
        for (const block of message.codeBlocks) {
          if (block.content) {
            stats.withContent++
            const {length} = block.content
            stats.contentLengths.min = Math.min(stats.contentLengths.min, length)
            stats.contentLengths.max = Math.max(stats.contentLengths.max, length)
            totalLength += length
            blockCount++
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
  }

  if (blockCount > 0) {
    stats.contentLengths.avg = totalLength / blockCount
  }

  if (stats.contentLengths.min === Infinity) {
    stats.contentLengths.min = 0
  }

  return stats
}

function printContentStats(stats: ContentStats): void {
  console.log('\nContent Statistics:')
  console.log('------------------')

  console.log('\nBy Type:')
  for (const [type, count] of Object.entries(stats.byType)) {
    console.log(`  ${type}: ${count}`)
  }

  console.log('\nBy Language:')
  for (const [lang, count] of Object.entries(stats.byLanguage)) {
    console.log(`  ${lang}: ${count}`)
  }

  console.log('\nBy Features:')
  for (const [feature, count] of Object.entries(stats.byFeatures)) {
    console.log(`  ${feature}: ${count}`)
  }

  console.log('\nContent Lengths:')
  console.log(`  Min: ${stats.contentLengths.min}`)
  console.log(`  Max: ${stats.contentLengths.max}`)
  console.log(`  Avg: ${stats.contentLengths.avg.toFixed(2)}`)

  console.log('\nTotals:')
  console.log(`  Total Blocks: ${stats.totalBlocks}`)
  console.log(`  With Content: ${stats.withContent}`)
}

function safeSlice(content: string | undefined, start: number, end: number): string {
  if (!content) return ''
  return content.slice(start, end)
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

    // Get all conversations and sort by creation date
    const items = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as {
      key: string
      value: string
    }[]

    console.log('\nSearching through', items.length, 'conversations...')

    // Look for our specific message
    for (const item of items) {
      try {
        const data = JSON.parse(item.value)
        const messages = Array.isArray(data.conversation) ? data.conversation : []

        const targetMessage = messages.find((msg: any) => msg.bubbleId === '517fb770-cce6-4cca-ad42-d409342ac3b2')
        if (targetMessage) {
          console.log('\nFound message in conversation:', data.name || 'Unnamed')
          console.log('Created:', new Date(data.createdAt).toLocaleString())

          // Process the diffs first
          processInlineDiffs(targetMessage)

          // Process the diffs
          if (targetMessage.afterCheckpoint?.activeInlineDiffs?.length) {
            console.log('\nProcessing diffs...')
            for (const diff of targetMessage.afterCheckpoint.activeInlineDiffs) {
              console.log(`\nDiff for file: ${diff.uri.path}`)

              if (diff.newTextDiffWrtV0) {
                for (const change of diff.newTextDiffWrtV0) {
                  console.log(`\nLines ${change.original.startLineNumber}-${change.original.endLineNumberExclusive}:`)
                  console.log('Modified code:')
                  console.log('```')
                  console.log(change.modified.join('\n'))
                  console.log('```')
                }
              }
            }
          }

          console.log('\nCode blocks:')
          if (targetMessage.codeBlocks?.length) {
            for (const block of targetMessage.codeBlocks) {
              console.log('\nBlock details:')
              console.log('File:', block.uri?.path)
              console.log('Language:', block.language || block.uri?.path?.split('.').pop() || 'unknown')

              if (block.start !== undefined && block.end !== undefined) {
                console.log('Lines:', block.start, '-', block.end)
              }

              if (block.content) {
                console.log('Content:')
                console.log('```')
                console.log(block.content)
                console.log('```')
              } else {
                console.log('No content available')
              }
            }
          } else {
            console.log('No code blocks found')
          }
        }
      } catch {
        // Skip invalid entries
      }
    }
  } finally {
    db?.close()
  }
}

await main().catch(console.error)
