export interface ChatSession {
  userId: number
  history: { role: 'user' | 'model'; text: string }[]
  context?: Record<string, unknown>
  lastActive: number
}

export interface ToolCall {
  name: string
  description: string
  handler: (args: Record<string, unknown>) => Promise<string>
}
