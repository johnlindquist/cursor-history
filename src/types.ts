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
      uri: {path: string}
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
  richText?: boolean
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
