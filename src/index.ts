import search from '@inquirer/search'
import { Command, Flags } from '@oclif/core'
import clipboardy from 'clipboardy'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import type { ConversationData } from './types.js'

import {
  extractGlobalConversations,
  getConversationsForWorkspace,
  getLatestConversation,
  getLatestConversationForWorkspace,
  listWorkspaces
} from './db/extract-conversations.js'
import { getConversationsPath, getOutputDir } from './utils/config.js'
import {
  formatConversation,
  generateConversationFilename,
  parseDateToEndOfDayTimestamp,
  parseDateToTimestamp
} from './utils/formatting.js'

export default class CursorHistory extends Command {
  static description = 'Manage and search Cursor conversation history'
  static enableJsonFlag = false // Disable JSON flag since we don't use it
  static examples = [
    `$ chi --extract
Extract all conversations to markdown files`,
    `$ chi --search
Interactively search and view conversations`,
    `$ chi --select
If current directory matches a workspace, list its conversations. Otherwise, select a workspace, list its conversations, and copy one to clipboard`,
    `$ chi --since 2023-06-01 --until 2023-07-01
Export the latest conversation within the specified date range`,
  ]
  static flags = {
    extract: Flags.boolean({
      char: 'e',
      description: 'Extract all conversations to markdown files',
      exclusive: ['search', 'select'],
    }),
    help: Flags.help({ char: 'h', description: 'Show CLI help' }),
    search: Flags.boolean({
      char: 's',
      description: 'Interactively search and view conversations',
      exclusive: ['extract', 'select'],
    }),
    select: Flags.boolean({
      char: 'l',
      description: 'If current directory matches a workspace, list its conversations. Otherwise, select a workspace, list its conversations, and copy one to clipboard',
      exclusive: ['extract', 'search'],
    }),
    since: Flags.string({
      dependsOn: [],
      description: 'Filter conversations created on or after the specified date (YYYY-MM-DD)',
    }),
    until: Flags.string({
      dependsOn: [],
      description: 'Filter conversations created on or before the specified date (YYYY-MM-DD)',
    }),
    version: Flags.boolean({
      char: 'v',
      description: 'Show CLI version',
    }),
  }
  private conversations: ConversationData[] = []

  async run(): Promise<void> {
    const { flags } = await this.parse(CursorHistory)

    if (flags.version) {
      this.log(this.config.version)
      return
    }

    // Parse date range flags if provided
    let sinceTimestamp: number | undefined
    let untilTimestamp: number | undefined

    if (flags.since) {
      const timestamp = parseDateToTimestamp(flags.since)
      if (timestamp === null) {
        this.error(`Invalid date format for --since: "${flags.since}". Please use YYYY-MM-DD format.`)
        return
      }
      sinceTimestamp = timestamp

      this.log(`Filtering conversations since: ${new Date(sinceTimestamp).toLocaleDateString()}`)
    }

    if (flags.until) {
      const timestamp = parseDateToEndOfDayTimestamp(flags.until)
      if (timestamp === null) {
        this.error(`Invalid date format for --until: "${flags.until}". Please use YYYY-MM-DD format.`)
        return
      }
      untilTimestamp = timestamp

      this.log(`Filtering conversations until: ${new Date(untilTimestamp).toLocaleDateString()}`)
    }

    const dateOptions = { sinceTimestamp, untilTimestamp }

    if (flags.extract || flags.search) {
      this.conversations = await extractGlobalConversations({
        ...dateOptions
      })

      if (!this.conversations || this.conversations.length === 0) {
        this.log('No conversations found.')
        return
      }

      if (flags.extract) {
        await this.extractConversations()
      } else if (flags.search) {
        await this.searchConversations()
      }
    } else if (flags.select) {
      // Select flag: select workspace, list conversations, select one, copy to clipboard
      await this.selectWorkspaceAndConversation(dateOptions)
    } else {
      // Default behavior: get latest conversation for current workspace or global latest

      // Get current directory name to use as workspace filter
      const currentDirName = basename(process.cwd())
      this.log(`Current directory: ${currentDirName}`)

      // Try to find a conversation for the current workspace
      const workspaceConversation = await getLatestConversationForWorkspace(
        currentDirName,
        dateOptions
      )

      if (workspaceConversation) {
        this.log(`Found conversation for workspace: ${currentDirName}`)
        await this.exportConversation(workspaceConversation)
      } else {
        // Fall back to global latest conversation
        this.log('No workspace-specific conversation found, using latest global conversation')
        const latestConversation = await getLatestConversation(dateOptions)
        if (!latestConversation) {
          this.log('No conversations found.')
          return
        }

        await this.exportConversation(latestConversation)
      }
    }
  }

  /**
   * Allows selecting a workspace, then lists conversations from that workspace,
   * allows selecting a conversation, and copies it to clipboard.
   * 
   * If the current directory name matches a workspace name, it will automatically
   * filter the list to only show conversations from that workspace.
   */
  private async selectWorkspaceAndConversation(dateOptions: { sinceTimestamp?: number; untilTimestamp?: number }): Promise<void> {
    // Get list of workspaces
    const workspaces = listWorkspaces()

    if (workspaces.length === 0) {
      this.log('No workspaces found.')
      return
    }

    this.log(`Found ${workspaces.length} workspaces.`)

    // Get current directory name to use as workspace filter
    const currentDirName = basename(process.cwd())
    this.log(`Current directory: ${currentDirName}`)

    // Check if current directory matches a workspace
    // Either the workspace name matches exactly (case-insensitive), or the currentDirName is contained in the workspace path (case-insensitive)
    const matchingWorkspace = workspaces.find(ws =>
      ws.name.toLowerCase() === currentDirName.toLowerCase() || ws.path.toLowerCase().includes(currentDirName.toLowerCase())
    )

    let selectedWorkspace: { name: string; path: string; id: string } | undefined

    if (matchingWorkspace) {
      // If there's a matching workspace, use it directly
      this.log(`Current directory matches workspace: ${matchingWorkspace.name}`)
      selectedWorkspace = matchingWorkspace
    } else {
      // Otherwise, allow selecting a workspace
      selectedWorkspace = await search({
        message: 'Select a workspace:',
        source: async (term) => {
          const termLower = term?.toLowerCase() || ''
          return workspaces
            .filter(ws => !term || ws.name.toLowerCase().includes(termLower))
            .map(ws => ({
              name: ws.name,
              value: ws,
              description: ws.path,
            }))
        },
      })
    }

    if (!selectedWorkspace) {
      this.log('No workspace selected.')
      return
    }

    this.log(`Selected workspace: ${selectedWorkspace.name}`)

    // Get conversations for the selected workspace
    // If the current directory matches a workspace, use the current directory name
    // Otherwise, use the selected workspace's name
    const workspaceNameToUse = matchingWorkspace ? currentDirName : selectedWorkspace.name
    this.log(`Using workspace name: ${workspaceNameToUse} for conversation lookup`)
    const workspaceConversations = await getConversationsForWorkspace(workspaceNameToUse, dateOptions)

    if (workspaceConversations.length === 0) {
      this.log(`No conversations found for workspace: ${selectedWorkspace.name}`)
      return
    }

    this.log(`Found ${workspaceConversations.length} conversations for workspace: ${selectedWorkspace.name}`)

    // Allow selecting a conversation
    const selectedConversation = await search({
      message: 'Select a conversation:',
      source: async (term) => {
        const termLower = term?.toLowerCase() || ''
        return workspaceConversations
          .filter(conv => !term ||
            (conv.conversation[0]?.text?.toLowerCase() || '').includes(termLower) ||
            (conv.text?.toLowerCase() || '').includes(termLower)
          )
          .map(conv => ({
            name: this.getDisplayName(conv),
            value: conv,
            description: new Date(conv.createdAt).toLocaleString(),
          }))
      },
    })

    if (!selectedConversation) {
      this.log('No conversation selected.')
      return
    }

    // Export the selected conversation
    await this.exportConversation(selectedConversation)
  }

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
  ): Promise<Array<{ description: string; name: string; value: ConversationData }>> {
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
