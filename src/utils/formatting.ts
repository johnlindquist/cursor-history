import type { ConversationData, FileChange, Message } from '../types.js'
import { countTokens } from './tokenCounter.js'

/**
 * Formats a numeric timestamp into an ISO string.
 * Returns null if the timestamp is invalid.
 */
export function formatTimestamp(timestamp: number): null | string {
  try {
    if (
      !Number.isFinite(timestamp) ||
      timestamp < new Date('2020-01-01').getTime() ||
      timestamp > new Date('2030-01-01').getTime()
    ) {
      return null
    }

    return new Date(timestamp).toISOString()
  } catch {
    return null
  }
}

/**
 * Formats a single Message into Markdown.
 */
export function formatMessage(message: Message): null | string {
  const hasText = typeof message.text === 'string' && message.text.trim().length > 0
  const hasCodeBlocks = Array.isArray(message.codeBlocks) && message.codeBlocks.length > 0
  const hasToolCalls = Array.isArray(message.toolCalls) && message.toolCalls.length > 0
  const hasFileChanges = message.checkpoint?.files?.some(
    (file: FileChange) => Array.isArray(file.modified) && file.modified.length > 0,
  )
  const hasSummary =
    typeof message.cachedConversationSummary?.summary === 'string' &&
    message.cachedConversationSummary.summary.trim().length > 0
  const hasMetadata = Boolean(message.metadata)

  const role =
    message.role ||
    (message.type === '1' || message.type === 1
      ? 'User'
      : message.type === '2' || message.type === 2
        ? 'Assistant'
        : 'Unknown')

  let output = `### ${role}\n\n`

  // Add timing information if available
  if (message.timingInfo) {
    const { clientEndTime, clientStartTime } = message.timingInfo
    if (clientStartTime && clientEndTime) {
      const formattedStart = new Date(clientStartTime).toLocaleString()
      const formattedEnd = new Date(clientEndTime).toLocaleString()
      const duration = (clientEndTime - clientStartTime) / 1000 // Convert to seconds

      output += `⏱️ `
      output +=
        formattedStart === formattedEnd
          ? `${formattedStart} (instant)\n\n`
          : `${duration.toFixed(1)}s • ${formattedStart} → ${formattedEnd}\n\n`
    }
  }

  if (hasText) {
    output += `${message.text?.trim()}\n\n`
  }

  if (hasMetadata && message.metadata) {
    output += '**Context:**\n'
    if (message.metadata.cursorContextFiles?.length) {
      output += '- Files:\n'
      for (const file of message.metadata.cursorContextFiles) {
        output += `  - \`${file}\`\n`
      }

      output += '\n'
    }

    if (message.metadata.cursorContextLines?.length) {
      output += '- Context Lines:\n```\n'
      output += message.metadata.cursorContextLines.join('\n')
      output += '\n```\n\n'
    }

    if (message.metadata.cursorContextSelectedCode) {
      output += '- Selected Code:\n```'
      if (message.metadata.cursorContextLanguage) {
        output += message.metadata.cursorContextLanguage
      }

      output += '\n'
      output += message.metadata.cursorContextSelectedCode
      output += '\n```\n\n'
    }

    if (message.metadata.cursorContextSelectedFile) {
      output += `- Selected File: \`${message.metadata.cursorContextSelectedFile}\`\n`
      if (
        typeof message.metadata.cursorContextStartLine === 'number' &&
        typeof message.metadata.cursorContextEndLine === 'number'
      ) {
        output += `- Line Range: ${message.metadata.cursorContextStartLine}-${message.metadata.cursorContextEndLine}\n`
      }

      output += '\n'
    }
  }

  if (message.checkpoint?.files) {
    for (const file of message.checkpoint.files) {
      if (Array.isArray(file.modified) && file.modified.length > 0) {
        const filename = file.uri.path.split('/').pop()
        output += `**File Changes in ${filename}:**\n\n`

        output += `Lines ${file.original.startLineNumber}-${file.original.endLineNumberExclusive}:\n`
        output += '```\n' + file.modified.join('\n') + '\n```\n\n'
      }
    }
  }

  if (hasSummary) {
    const summary = message.cachedConversationSummary!.summary.trim()
    output += `**Summary:**\n${summary}\n\n`
  }

  const metadata: string[] = []
  if (message.type) metadata.push(`Type: ${message.type}`)
  if (message.bubbleId) metadata.push(`ID: ${message.bubbleId}`)
  if (hasCodeBlocks) metadata.push(`Code Blocks: ${message.codeBlocks!.length}`)
  if (hasToolCalls) metadata.push(`Tool Calls: ${message.toolCalls!.length}`)
  if (hasFileChanges) metadata.push('Has File Changes')
  if (hasSummary) metadata.push('Has Summary')
  if (hasMetadata) metadata.push('Has Context')

  if (metadata.length > 0) {
    output += '_Metadata:_ ' + metadata.join(' | ') + '\n\n'
  }

  if (hasCodeBlocks) {
    for (const block of message.codeBlocks!) {
      const content = block?.content || block?.code
      const language = block?.language || block?.languageId || ''

      if (block?.uri?.path) {
        const filename = block.uri.path.split('/').pop() || 'unknown'

        output += `\`\`\`${language.toLowerCase()}\n`
        output += `// File: ${filename}\n`
        if (block.start !== undefined && block.end !== undefined) {
          output += `// Lines: ${block.start}-${block.end}\n`
        }

        if (block.codeBlockIdx !== undefined) {
          output += `// Block Index: ${block.codeBlockIdx}\n`
        }

        if (block.isGenerating) {
          output += '// Status: Generating...\n'
        }

        output += '\n'

        if (content?.trim()) {
          output += content.trim()
        } else {
          // Provide more context about why content is not available
          const reasons = []
          if (!block.content && !block.code) reasons.push('No content or code property')
          if (block.isGenerating) reasons.push('Content is still generating')
          output += `// Content not available: ${reasons.join(', ') || 'Unknown reason'}`
        }

        output += '\n```\n\n'
      } else if (content) {
        output += `\`\`\`${language.toLowerCase()}\n${content.trim()}\n\`\`\`\n\n`
      }
    }
  }

  return output
}

/**
 * Formats a conversation into Markdown.
 */
export function formatConversation(conversation: ConversationData, model: string = 'gpt-4'): string {
  let output = ''

  // Add header with conversation info
  const date = new Date(conversation.createdAt).toLocaleString()
  output += `# ${conversation.name || 'Unnamed Conversation'}\n\n`
  output += `_Created: ${date}_\n\n`

  if (conversation.workspaceName) {
    output += `_Workspace: \`${conversation.workspaceName}\`_\n\n`
  }

  // Format each message
  let totalTokens = 0
  for (const message of conversation.conversation) {
    const formatted = formatMessage(message)
    if (formatted) {
      output += formatted
      totalTokens += countTokens(message.content || '', model)
      if (message.codeBlocks) {
        for (const block of message.codeBlocks) {
          totalTokens += countTokens(block.content || block.code || '', model)
        }
      }
    }
  }

  // Add token count to footer
  output += `\n✓ Token count: ${totalTokens.toLocaleString()} tokens\n`
  return output
}

/**
 * Checks if a conversation has any messages from the Assistant
 */
export function hasAssistantMessages(conversation: ConversationData): boolean {
  return conversation.conversation.some(
    (message) => message.role === 'Assistant' || message.type === '2' || message.type === 2,
  )
}

/**
 * Generates a filename for a conversation based on its metadata.
 */
export function generateConversationFilename(conversation: ConversationData): string {
  const date = new Date(conversation.createdAt)
  const dateStr = date.toISOString().split('T')[0]
  const timeStr = `${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}`
  const workspace = conversation.workspaceName || 'unnamed-workspace'
  const name = conversation.name || 'unnamed'
  const sanitizedWorkspace = workspace
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
  const sanitizedName = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')

  return `${sanitizedWorkspace}-${dateStr}-${timeStr}-${sanitizedName}.md`
}
