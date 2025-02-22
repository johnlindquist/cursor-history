import search from '@inquirer/search'
import {Command, Flags} from '@oclif/core'
import clipboardy from 'clipboardy'
import {writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ConversationData} from './types.js'

import {extractGlobalConversations, getLatestConversation} from './db/extract-conversations.js'
import {getConversationsPath, getOutputDir} from './utils/config.js'
import {formatConversation, generateConversationFilename} from './utils/formatting.js'

export default class CursorHistory extends Command {
  static description = 'Manage and search Cursor conversation history'
  static enableJsonFlag = false // Disable JSON flag since we don't use it
  static examples = [
    `$ chi --extract
Extract all conversations to markdown files`,
    `$ chi --search
Interactively search and view conversations`,
  ]
  static flags = {
    extract: Flags.boolean({
      char: 'e',
      description: 'Extract all conversations to markdown files',
      exclusive: ['search'],
    }),
    help: Flags.help({char: 'h', description: 'Show CLI help'}),
    search: Flags.boolean({
      char: 's',
      description: 'Interactively search and view conversations',
      exclusive: ['extract'],
    }),
    version: Flags.boolean({
      char: 'v',
      description: 'Show CLI version',
    }),
  }
  private conversations: ConversationData[] = []

  private async exportConversation(conversation: ConversationData): Promise<void> {
    const markdown = formatConversation(conversation)

    // Write to temp file
    const tempDir = tmpdir()
    const filename = generateConversationFilename(conversation)
    const outputPath = join(tempDir, filename)
    writeFileSync(outputPath, markdown)

    // Copy to clipboard
    await clipboardy.write(markdown)

    this.log(`\nConversation exported to: ${outputPath}`)
    this.log('Content has been copied to clipboard.')
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(CursorHistory)

    if (flags.version) {
      this.log(this.config.version)
      return
    }

    if (flags.extract || flags.search) {
      this.conversations = await extractGlobalConversations()

      if (!this.conversations || this.conversations.length === 0) {
        this.log('No conversations found.')
        return
      }

      if (flags.extract) {
        await this.extractConversations()
      } else if (flags.search) {
        await this.searchConversations()
      }
    } else {
      // Default behavior: get latest conversation
      const latestConversation = await getLatestConversation()
      if (!latestConversation) {
        this.log('No conversations found.')
        return
      }
      await this.exportConversation(latestConversation)
    }
  }

  private async extractConversations(): Promise<void> {
    this.log('Starting conversation extraction...')
    const outputDir = getOutputDir()

    // Create individual conversation files
    const indexEntries: string[] = []
    for (const conv of this.conversations) {
      const markdown = formatConversation(conv)
      const filename = generateConversationFilename(conv)
      const outputPath = join(outputDir, filename)
      writeFileSync(outputPath, markdown)

      const date = new Date(conv.createdAt).toLocaleString()
      const preview = conv.text?.slice(0, 60) || 'No preview available'
      indexEntries.push(`- [${date}](${filename})\n  ${preview}...\n`)
    }

    // Create index file
    const indexPath = join(outputDir, 'index.md')
    const indexContent = `# Cursor Conversations\n\n${indexEntries.join('\n')}`
    writeFileSync(indexPath, indexContent)

    this.log(`\nExtraction Summary:`)
    this.log(`- Conversations extracted: ${this.conversations.length}`)
    this.log(`- Conversations directory: ${getConversationsPath()}`)
    this.log(`- Latest output: ${outputDir}`)
    this.log('\nExtraction complete!')
  }

  private getDisplayName(conversation: ConversationData): string {
    const date = new Date(conversation.createdAt).toLocaleString()
    const preview = conversation.conversation[0]?.text?.slice(0, 100) || 'No preview available'
    return `${date} - ${preview}...`
  }

  private async searchConversations(): Promise<void> {
    this.log('Loading conversations...')

    const selectedConversation = await search({
      message: 'Search conversations:',
      source: async (term) => this.searchConversationSource(term),
    })

    await this.exportConversation(selectedConversation)
  }

  private async searchConversationSource(
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
