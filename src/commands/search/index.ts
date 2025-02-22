import search from '@inquirer/search'
import {Command} from '@oclif/core'
import clipboardy from 'clipboardy'
import {writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ConversationData} from '../../types.js'

import {extractGlobalConversations} from '../../db/extract-conversations.js'
import {formatConversation, generateConversationFilename} from '../../utils/formatting.js'

export default class Search extends Command {
  static aliases = [''] // This makes it the default command
  static description = 'Search and view conversations from Cursor global storage'
  static examples = [
    `<%= config.bin %> <%= command.id %>
Interactively search and view conversations from Cursor's global storage database
`,
  ]
  private conversations: ConversationData[] = []

  async run(): Promise<void> {
    this.log('Loading conversations...')

    this.conversations = await extractGlobalConversations()

    if (!this.conversations || this.conversations.length === 0) {
      this.log('No conversations found.')
      return
    }

    const selectedConversation = await search({
      message: 'Search conversations:',
      source: async (term) => this.searchConversations(term),
    })

    const markdown = formatConversation(selectedConversation)

    // Write to temp file
    const tempDir = tmpdir()
    const filename = generateConversationFilename(selectedConversation)
    const outputPath = join(tempDir, filename)
    writeFileSync(outputPath, markdown)

    // Copy to clipboard
    await clipboardy.write(markdown)

    this.log(`\nConversation exported to: ${outputPath}`)
    this.log('Content has been copied to clipboard.')
  }

  private getDisplayName(conversation: ConversationData): string {
    const date = new Date(conversation.createdAt).toLocaleString()
    const preview = conversation.conversation[0]?.text?.slice(0, 100) || 'No preview available'
    return `${date} - ${preview}...`
  }

  private async searchConversations(
    term: string | undefined,
  ): Promise<Array<{description: string; name: string; value: ConversationData}>> {
    if (!term) return []

    const termLower = term.toLowerCase()
    return this.conversations
      .filter((conv) => {
        const text = conv.conversation[0]?.text?.toLowerCase() || ''
        return text.includes(termLower)
      })
      .map((conv) => ({
        description: new Date(conv.createdAt).toLocaleString(),
        name: this.getDisplayName(conv),
        value: conv,
      }))
  }
}
