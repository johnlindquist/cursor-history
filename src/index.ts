import search from '@inquirer/search'
import { Command, Flags } from '@oclif/core'
import clipboardy from 'clipboardy'
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
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
import { formatConversation, generateConversationFilename } from './utils/formatting.js'

const EXAMPLE_EXTRACT = `$ chi --extract\nExtract all conversations to markdown files`;
const EXAMPLE_SEARCH = `$ chi --search\nInteractively search and view conversations`;
const EXAMPLE_SELECT = `$ chi --select\nIf current directory matches a workspace, list its conversations. Otherwise, select a workspace, list its conversations, and copy one to clipboard`;
const EXAMPLE_MANAGE = `$ chi --manage --older-than 30d\nRemove conversation files older than 30 days`;

/**
 * Parse a duration string into milliseconds
 * @param duration Duration string like "30d", "2w", "1m"
 * @returns Duration in milliseconds or null if invalid format
 */
function parseDuration(duration: string): null | number {
  const match = duration.match(/^(\d+)([dwm])$/)
  if (!match) return null

  const value = Number.parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 'd': { // days
      return value * 24 * 60 * 60 * 1000
    }

    case 'm': { // months (approximate)
      return value * 30 * 24 * 60 * 60 * 1000
    }

    case 'w': { // weeks
      return value * 7 * 24 * 60 * 60 * 1000
    }

    default: {
      return null
    }
  }
}

export default class CursorHistory extends Command {
  static description = 'Manage and search Cursor conversation history'
  static enableJsonFlag = false // Disable JSON flag since we don't use it
  static examples = [
    EXAMPLE_EXTRACT,
    EXAMPLE_SEARCH,
    EXAMPLE_SELECT,
    EXAMPLE_MANAGE,
  ]
  static flags = {
    archive: Flags.boolean({
      dependsOn: ['manage'],
      description: 'Archive old conversations instead of deleting them',
    }),
    extract: Flags.boolean({
      char: 'e',
      description: 'Extract all conversations to markdown files',
      exclusive: ['search', 'select', 'manage'],
    }),
    help: Flags.help({ char: 'h', description: 'Show CLI help' }),
    manage: Flags.boolean({
      char: 'm',
      description: 'Manage extracted conversation files',
      exclusive: ['extract', 'search', 'select'],
    }),
    'older-than': Flags.string({
      dependsOn: ['manage'],
      description: 'Remove files older than specified duration (e.g., 30d for 30 days, 2w for 2 weeks, 1m for 1 month)',
    }),
    search: Flags.boolean({
      char: 's',
      description: 'Interactively search and view conversations',
      exclusive: ['extract', 'select', 'manage'],
    }),
    select: Flags.boolean({
      char: 'l',
      description: 'If current directory matches a workspace, list its conversations. Otherwise, select a workspace, list its conversations, and copy one to clipboard',
      exclusive: ['extract', 'search', 'manage'],
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
    } else if (flags.select) {
      // Select flag: select workspace, list conversations, select one, copy to clipboard
      await this.selectWorkspaceAndConversation()
    } else if (flags.manage) {
      // Manage flag: prune/archive old conversation files
      await this.manageConversationFiles(flags['older-than'], flags.archive)
    } else {
      // Default behavior: get latest conversation for current workspace or global latest

      // Get current directory name to use as workspace filter
      const currentDirName = basename(process.cwd())
      this.log(`Current directory: ${currentDirName}`)

      // Try to find a conversation for the current workspace
      const workspaceConversation = await getLatestConversationForWorkspace(currentDirName)

      if (workspaceConversation) {
        this.log(`Found conversation for workspace: ${currentDirName}`)
        await this.exportConversation(workspaceConversation)
      } else {
        // Fall back to global latest conversation
        this.log('No workspace-specific conversation found, using latest global conversation')
        const latestConversation = await getLatestConversation()
        if (!latestConversation) {
          this.log('No conversations found.')
          return
        }

        await this.exportConversation(latestConversation)
      }
    }
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
    // Prioritize conversation name, fallback to first message text preview
    const title = conversation.name && conversation.name !== 'Unnamed Conversation'
      ? conversation.name
      : conversation.conversation[0]?.text?.slice(0, 100) || 'No preview available'
    // Add workspace name if available and different from title
    const workspaceSuffix = conversation.workspaceName && conversation.workspaceName !== title
      ? ` (Workspace: ${conversation.workspaceName})`
      : ''
    return `${date} - ${title}${workspaceSuffix}`;
  }

  private async manageConversationFiles(olderThan: string | undefined, archive: boolean): Promise<void> {
    if (!olderThan) {
      this.log('Please specify a duration using the --older-than flag.')
      this.log('Example: chi --manage --older-than 30d')
      return
    }

    const duration = parseDuration(olderThan)
    if (!duration) {
      this.log('Invalid duration format. Please use d for days, w for weeks, or m for months.')
      this.log('Examples: 30d (30 days), 2w (2 weeks), 1m (1 month)')
      return
    }

    const conversationsDir = getConversationsPath()
    const cutoffDate = new Date(Date.now() - duration)
    let filesRemoved = 0
    let filesArchived = 0
    let dirsProcessed = 0

    this.log(`Managing files older than ${olderThan} (before ${cutoffDate.toLocaleDateString()})`)

    // Get all generation directories in the conversations directory
    const generationDirs = readdirSync(conversationsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)

    // Create archive directory if needed
    const archiveDir = join(conversationsDir, 'archive')
    if (archive && !existsSync(archiveDir)) {
      mkdirSync(archiveDir)
    }

    for (const dirName of generationDirs) {
      // Skip 'archive' directory
      if (dirName === 'archive') continue

      const dirPath = join(conversationsDir, dirName)

      // Try to parse the date from the directory name (ISO format with dashes)
      try {
        const dirDate = new Date(dirName.replaceAll('-', ':').replace('T', ' '))

        // If the directory is older than the cutoff
        if (dirDate < cutoffDate) {
          const files = readdirSync(dirPath, { withFileTypes: true })
            .filter(dirent => dirent.isFile())
            .map(dirent => dirent.name)

          dirsProcessed++

          if (archive) {
            // Create matching archive subdirectory
            const archiveSubDir = join(archiveDir, dirName)
            if (!existsSync(archiveSubDir)) {
              mkdirSync(archiveSubDir)
            }

            // Move each file to archive
            for (const fileName of files) {
              renameSync(
                join(dirPath, fileName),
                join(archiveSubDir, fileName)
              )
              filesArchived++
            }

            this.log(`Archived directory: ${dirName} (${files.length} files)`)
          } else {
            // Delete each file
            for (const fileName of files) {
              unlinkSync(join(dirPath, fileName))
              filesRemoved++
            }

            this.log(`Removed files from directory: ${dirName} (${files.length} files)`)
          }
        }
      } catch (error) {
        this.log(`Error processing directory ${dirName}: ${String(error)}`)
      }
    }

    this.log(`\nManagement Summary:`)
    this.log(`- Directories processed: ${dirsProcessed}`)

    if (archive) {
      this.log(`- Files archived: ${filesArchived}`)
      this.log(`- Archive location: ${archiveDir}`)
    } else {
      this.log(`- Files removed: ${filesRemoved}`)
    }

    this.log('\nConversation files management complete!')
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
      // Filter based on conversation name (title)
      .filter((conv) => {
        const nameMatch = conv.name?.toLowerCase().includes(termLower);
        // Optionally, could also search workspace name or first message as fallback?
        // const firstMessageMatch = conv.conversation[0]?.text?.toLowerCase().includes(termLower);
        return nameMatch; // For now, only search name
      })
      .map((conv) => ({
        // Use the potentially updated display name function
        name: this.getDisplayName(conv),
        // Keep description as date for sorting/info
        description: `Created: ${new Date(conv.createdAt).toLocaleString()}${conv.workspaceName ? ' | Workspace: ' + conv.workspaceName : ''}`,
        value: conv,
      }))
  }

  /**
   * Allows selecting a workspace, then lists conversations from that workspace,
   * allows selecting a conversation, and copies it to clipboard.
   * 
   * If the current directory name matches a workspace name, it will automatically
   * filter the list to only show conversations from that workspace.
   */
  private async selectWorkspaceAndConversation(): Promise<void> {
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
    const matchingWorkspace = workspaces.find((ws: { id: string; name: string; path: string; }) =>
      ws.name.toLowerCase() === currentDirName.toLowerCase()
    )

    let selectedWorkspace: undefined | { id: string; name: string; path: string; }

    if (matchingWorkspace) {
      // If there's a matching workspace, use it directly
      this.log(`Current directory matches workspace: ${matchingWorkspace.name}`)
      selectedWorkspace = matchingWorkspace
    } else {
      // Otherwise, allow selecting a workspace
      selectedWorkspace = await search({
        message: 'Select a workspace:',
        async source(term) {
          const termLower = term?.toLowerCase() || ''
          return workspaces
            .filter((ws: { id: string; name: string; path: string; }) =>
              !term || ws.name.toLowerCase().includes(termLower)
            )
            .map((ws: { id: string; name: string; path: string; }) => ({
              description: ws.path,
              name: ws.name,
              value: ws,
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
    const workspaceConversations = await getConversationsForWorkspace(workspaceNameToUse)

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
            description: new Date(conv.createdAt).toLocaleString(),
            name: this.getDisplayName(conv),
            value: conv,
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
}