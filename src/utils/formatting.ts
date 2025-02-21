import type {CodeBlock, ConversationData, FileChange, Message, Selection, ToolCall} from '../types.js'

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

  const role =
    message.role ||
    (message.type === '1' || message.type === 1
      ? 'User'
      : message.type === '2' || message.type === 2
      ? 'Assistant'
      : 'Unknown')

  let output = `### ${role}\n\n`

  if (hasText) {
    output += `${message.text.trim()}\n\n`
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

  if (metadata.length > 0) {
    output += '_Metadata:_ ' + metadata.join(' | ') + '\n\n'
  }

  if (hasCodeBlocks) {
    for (const block of message.codeBlocks!) {
      if (block?.uri?.path && block?.codeBlockIdx !== undefined) {
        const filename = block.uri.path.split('/').pop() || 'unknown'
        output += `\`\`\`\nFile Reference: ${filename}\nBlock Index: ${block.codeBlockIdx}\n\`\`\`\n\n`
      } else if (block && typeof block.code === 'string') {
        const language = typeof block.language === 'string' ? block.language.toLowerCase() : ''
        const code = block.code.trim()
        if (code) {
          output += `\`\`\`${language}\n${code}\n\`\`\`\n\n`
        }
      }
    }
  }

  if (hasToolCalls) {
    for (const [index, call] of message.toolCalls!.entries()) {
      if (call && typeof call === 'object') {
        output += `**Tool Call ${index + 1}:**\n`
        output += `- Type: ${call.type || 'unknown'}\n`

        if (call.name) output += `- Function: \`${call.name}\`\n`

        if (call.parameters) {
          output += '- Parameters:\n'
          for (const [key, value] of Object.entries(call.parameters)) {
            output += `  - \`${key}\`: ${JSON.stringify(value)}\n`
          }
        }

        if (call.result) {
          const resultStr = typeof call.result === 'string' ? call.result : JSON.stringify(call.result)
          output += `- Result: ${resultStr.length > 100 ? resultStr.slice(0, 100) + '...' : resultStr}\n`
        }

        output += '\n'
      }
    }
  }

  if (message.timingInfo) {
    const start = formatTimestamp(message.timingInfo.startTime)
    const end = formatTimestamp(message.timingInfo.endTime)
    if (start && end) {
      output += `_${start} - ${end}_\n\n`
    }
  }

  output += '---\n'
  return output.trim()
}

/**
 * Formats an entire conversation into a Markdown document.
 */
export function formatConversation(data: ConversationData): string {
  let output = `# Conversation ${data.composerId}\n\n`
  output += `Created: ${new Date(data.createdAt).toISOString()}\n\n`

  if (data.context) {
    if (Array.isArray(data.context.fileSelections) && data.context.fileSelections.length > 0) {
      output += '## File Selections\n\n'
      for (const selection of data.context.fileSelections) {
        if (selection && selection.file) {
          const selectionText = selection.selection || 'No selection text'
          output += `- ${selection.file}: ${selectionText}\n`
        }
      }

      output += '\n'
    }

    if (Array.isArray(data.context.selections) && data.context.selections.length > 0) {
      output += '## Code Selections\n\n'
      for (const selection of data.context.selections) {
        if (selection && selection.text) {
          output += `\`\`\`\n${selection.text.trim()}\n\`\`\`\n`
        }
      }

      output += '\n'
    }

    if (Array.isArray(data.context.terminalSelections) && data.context.terminalSelections.length > 0) {
      output += '## Terminal Output\n\n'
      for (const selection of data.context.terminalSelections) {
        if (selection && selection.text) {
          output += `\`\`\`\n${selection.text.trim()}\n\`\`\`\n`
        }
      }

      output += '\n'
    }
  }

  if (Array.isArray(data.conversation) && data.conversation.length > 0) {
    output += '## Messages\n\n'
    const formattedMessages = data.conversation
      .map((msg: Message) => msg && formatMessage(msg))
      .filter((msg): msg is string => msg !== null)
    if (formattedMessages.length > 0) {
      output += formattedMessages.join('\n')
      output += '\n'
    } else {
      output += '_No messages with content in conversation_\n\n'
    }
  } else {
    output += '## Messages\n\n_No messages in conversation_\n\n'
  }

  return output.trim()
}
