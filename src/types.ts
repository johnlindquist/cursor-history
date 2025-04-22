export interface CodeBlock {
  code: string
  codeBlockIdx?: number
  content?: string
  end?: number
  isGenerating?: boolean
  language: string
  start?: number
  uri?: {
    path: string
  }
}

export interface ToolCall {
  name?: string
  parameters?: Record<string, unknown>
  result?: string | unknown
  type?: string
}

export interface FileChange {
  modified: string[]
  original: {
    endLineNumberExclusive: number
    startLineNumber: number
  }
  uri: {
    path: string
  }
}

export interface Selection {
  file?: string
  selection?: string
  text?: string
}

export interface Message {
  attachments?: unknown[]
  bubbleId?: string
  cachedConversationSummary?: {
    summary: string
  }
  checkpoint?: {
    files?: Array<{
      modified: string[]
      original: {
        endLineNumberExclusive: number
        startLineNumber: number
      }
      uri: { path: string }
    }>
  }
  codeBlocks?: Array<{
    code?: string
    codeBlockIdx?: number
    content?: string
    end?: number
    isGenerating?: boolean
    language?: string
    languageId?: string
    start?: number
    uri?: {
      external?: string
      fsPath?: string
      path: string
      scheme?: string
    }
  }>
  content: string
  metadata?: {
    [key: string]: unknown
    cursorContextEndLine?: number
    cursorContextFiles?: string[]
    cursorContextFileType?: string
    cursorContextGitBranch?: string
    cursorContextGitRepo?: string
    cursorContextLanguage?: string
    cursorContextLines?: string[]
    cursorContextProjectRoot?: string
    cursorContextSelectedCode?: string
    cursorContextSelectedFile?: string
    cursorContextStartLine?: number
  }
  role: string
  text?: string
  timestamp?: number
  timingInfo?: {
    clientEndTime: number
    clientRpcSendTime: number
    clientSettleTime: number
    clientStartTime: number
  }
  toolCalls?: Array<{
    name?: string
    parameters?: Record<string, unknown>
    result?: unknown
    type: string
  }>
  tools?: unknown[]
  type?: number | string
}

export interface ConversationData {
  composerId: string
  context?: {
    fileSelections?: Array<{
      file: string
      selection?: string
    }>
    selections?: Array<{
      text: string
    }>
    terminalSelections?: Array<{
      text: string
    }>
  }
  conversation: Message[]
  createdAt: number
  name?: string
  text?: string
  unifiedMode?: string
  workspaceName?: string
  workspacePath?: string
}

export interface MessageAnalysisResult {
  blocks?: Array<{
    analysis: CodeBlockAnalysis
    block: Partial<CodeBlock>
  }>
  codeBlocks: CodeBlockAnalysis[]
  content: string
  contentLength: number
  hasAttachments: boolean
  hasCode: boolean
  hasMetadata: boolean
  hasTools: boolean
  isEmpty: boolean
  metadataDetails?: {
    additionalKeys: string[]
    hasContextFiles: boolean
    hasContextLines: boolean
    hasFileType: boolean
    hasGitInfo: boolean
    hasLanguage: boolean
    hasLineRange: boolean
    hasProjectInfo: boolean
    hasSelectedCode: boolean
    hasSelectedFile: boolean
  }
  role: string
  stats?: {
    avgBlockLength: number
    totalBlocks: number
    totalLength: number
  }
  timestamp: number
}

export interface CodeBlockAnalysis {
  content: string | undefined
  contentAnalysis: {
    hasClasses: boolean
    hasFunctions: boolean
    hasImports: boolean
    hasJSX: boolean
    hasMarkdown: boolean
    indentationLevel: number
    lineCount: number
  }
  contentLength: number
  fileContext?: {
    lineEnd?: number
    lineStart?: number
    path: string
  }
  hasContent: boolean
  isGenerating: boolean
  language: string | undefined
  type: 'code' | 'text' | 'unknown'
}

export interface ConversationAnalysis {
  contentAnalysis: {
    contentTypes: {
      code: number
      text: number
      unknown: number
    }
    fileReferences: Record<
      string,
      {
        count: number
        hasLineRanges: boolean
      }
    >
    generatingBlocks: number
    languages: string[]
    messagesWithContent: number
    totalCodeBlocks: number
  }
  createdAt: number
  id: string
  key: string
  messageCount: number
  messages: MessageAnalysisResult[]
  mode: string
  name: string
}

// --- New Types for Raw Database Structure --- 

export interface RichTextContentNode {
  text?: string
  type: string
  // Other potential fields like marks, attrs might be needed
}

export interface RichTextBlockNode {
  attrs?: { // Add optional attrs field
    [key: string]: any // Allow other potential attributes
    params?: string // Specifically for code block language based on investigation
  }
  children?: RichTextNode[] // For nested blocks (e.g., paragraphs inside list items)
  content?: RichTextContentNode[] // For text/marks within a block
  type: string // e.g., 'paragraph', 'code'
  // Other potential fields like marks might be needed
}

// Base type combining potential structures (adjust based on real data if needed)
export type RichTextNode = RichTextBlockNode | RichTextContentNode

export interface RichTextRoot {
  root: {
    children: RichTextNode[]
    // Other potential root fields
  }
}

// Represents an item directly in the `conversation` array from the DB
export interface ConversationItem {
  _v?: number
  allThinkingBlocks?: unknown[]
  attachedFoldersListDirResults?: unknown[]
  attachedHumanChanges?: unknown[]
  bubbleId: string
  cachedConversationSummary?: unknown
  capabilitiesRan?: unknown[]
  capabilityStatuses?: unknown[]
  capabilityType?: string
  checkpointId?: string
  codeBlocks?: Partial<CodeBlock>[] // Optional, sometimes present on type 2 items
  context?: unknown
  contextPieces?: unknown[]
  cursorRules?: unknown[]
  deletedFiles?: unknown[]
  diffHistories?: unknown[]
  diffsSinceLastApply?: unknown[]
  docsReferences?: unknown[]
  editTrailContexts?: unknown[]
  existedPreviousTerminalCommand?: boolean
  existedSubsequentTerminalCommand?: boolean
  fileDiffTrajectories?: unknown[]
  fileLinks?: unknown[]
  humanChanges?: unknown[]
  intermediateChunks?: unknown[]
  isAgentic?: boolean
  isCapabilityIteration?: boolean
  isChat?: boolean
  isThought?: boolean
  multiFileLinterErrors?: unknown[]
  recentLocationsHistory?: unknown[]
  // Add other observed optional fields if necessary for specific logic later
  relevantFiles?: unknown[]
  richText?: string // Stringified JSON (likely RichTextRoot structure)
  serverBubbleId?: string
  summarizedComposers?: unknown[]
  supportedTools?: unknown[]
  symbolLinks?: unknown[]
  text?: string // Can be empty, sometimes contains assistant message
  timingInfo?: any // Optional, sometimes present on type 2 items
  tokenCount?: number
  tokenCountUpUntilHere?: number
  tokenDetailsUpUntilHere?: unknown
  type: number // 1 for user, 2 for assistant/system
  unifiedMode?: string
  usageUuid?: string
  webReferences?: unknown[]
}

// --- End New Types --- 
