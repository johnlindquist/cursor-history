import {Command} from '@oclif/core'
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {extractGlobalConversations} from '../../db/extract-conversations.js'
import {createOutputDir} from '../../utils/file-system.js'
import {formatConversation} from '../../utils/formatting.js'

export default class Extract extends Command {
  static description = 'Extract conversations from Cursor global storage'
  static examples = [
    `<%= config.bin %> <%= command.id %>
Extracts all conversations from Cursor's global storage database and saves them as markdown files
`,
  ]

  async run(): Promise<void> {
    this.log('Starting conversation extraction...')
    const conversations = extractGlobalConversations()

    if (conversations.length > 0) {
      const outputDir = createOutputDir()

      for (const conv of conversations) {
        const filename = `${conv.composerId}.md`
        const outputPath = join(outputDir, filename)
        writeFileSync(outputPath, formatConversation(conv))
        this.log(`Wrote conversation to ${outputPath}`)
      }

      // Create an index file
      const indexPath = join(outputDir, 'index.md')
      const indexContent = conversations
        .map((conv) => {
          const date = new Date(conv.createdAt).toISOString()
          const preview = conv.conversation[0]?.text?.slice(0, 100) || 'No preview available'
          return `- [${date}](${conv.composerId}.md)\n  ${preview}...\n`
        })
        .join('\n')

      writeFileSync(indexPath, `# Conversations Index\n\n${indexContent}`)
      this.log(`Wrote index to ${indexPath}`)
    }

    this.log('Extraction complete!')
  }
}
