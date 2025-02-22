import type {ConversationData, FileChange, Message} from '../types.js'

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

        output += '\n'

        output += content?.trim() ? content.trim() : '// Content not available'

        output += '\n```\n\n'
      } else if (content) {
        output += `\`\`\`${language.toLowerCase()}\n`
        output += content.trim()
        output += '\n```\n\n'
      }

      if (block.isGenerating) {
        output += '_Generating..._\n\n'
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
 * Convert a string to a URL-friendly slug
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric chars with hyphens
    .replaceAll(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .slice(0, 100) // Limit length
}

/**
 * Generate a descriptive filename for a conversation
 */
export function generateConversationFilename(data: ConversationData): string {
  const date = new Date(data.createdAt)
  const dateStr = date.toISOString().split('T')[0]
  const timeStr = `${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}`
  const workspace = data.workspaceName || 'unknown-workspace'
  const title = data.name || `Conversation ${data.composerId}`

  return `${slugify(workspace)}-${dateStr}-${timeStr}-${slugify(title)}-${data.composerId}.md`
}

/**
 * Formats an entire conversation into a Markdown document.
 */
export function formatConversation(data: ConversationData): string {
  let output = `# ${data.name || `Conversation ${data.composerId}`}\n\n`

  if (data.workspaceName) {
    output += `**Workspace:** ${data.workspaceName}\n`
    if (data.workspacePath) {
      output += `**Path:** ${data.workspacePath}\n`
    }

    output += '\n'
  }

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
