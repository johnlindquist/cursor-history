import { Command } from '@oclif/core'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { extractGlobalConversations } from '../../db/extract-conversations.js'
import { getConversationsPath, getOutputDir } from '../../utils/config.js'
import { formatConversation, generateConversationFilename, hasAssistantMessages } from '../../utils/formatting.js'

export default class Extract extends Command {
  static description = 'Extract conversations from Cursor global storage'
  static examples = [
    `<%= config.bin %> <%= command.id %>
Extracts all conversations from Cursor's global storage database and saves them as markdown files
`,
  ]

  async run(): Promise<void> {
    this.log('Starting conversation extraction...')
    const allConversations = await extractGlobalConversations()
    const conversations = allConversations.filter(
      (conv) => hasAssistantMessages(conv)
    )
    const skipped = allConversations.length - conversations.length

    if (conversations.length > 0) {
      const outputDir = getOutputDir()

      // Create individual conversation files
      const indexEntries: string[] = []
      for (const conv of conversations) {
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
      this.log(`- Conversations extracted: ${conversations.length}`)
      this.log(`- Conversations skipped (no assistant messages): ${skipped}`)
      this.log(`- Conversations directory: ${getConversationsPath()}`)
      this.log(`- Latest output: ${outputDir}`)
    } else {
      this.log('No conversations with assistant messages found to extract.')
    }

    this.log('\nExtraction complete!')
  }
}
