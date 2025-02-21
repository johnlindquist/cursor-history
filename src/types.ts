export interface CodeBlock {
  code?: string
  codeBlockIdx?: number
  language?: string
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
  bubbleId: string
  cachedConversationSummary?: {
    summary: string
  }
  checkpoint?: {
    files: FileChange[]
  }
  codeBlocks?: CodeBlock[]
  role?: string
  text: string
  timingInfo?: {
    endTime: number
    startTime: number
  }
  toolCalls?: ToolCall[]
  type?: 1 | 2 | '1' | '2' | string // 1 = User, 2 = Assistant
}

export interface ConversationData {
  composerId: string
  context?: {
    fileSelections?: Selection[]
    selections?: Selection[]
    terminalSelections?: Selection[]
  }
  conversation: Message[]
  createdAt: number
  richText?: string
  text?: string
}
