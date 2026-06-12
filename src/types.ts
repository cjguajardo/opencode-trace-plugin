import type { Event, Message, Part } from "@opencode-ai/sdk"

export interface TraceRecord {
  id: string
  timestamp: number
  session_id: string
  event_type: string
  payload: string // JSON
  synced: number // 0 or 1 (SQLite INTEGER)
}

export interface ToolTrace {
  call_id: string
  session_id: string
  message_id: string
  tool: string
  args: string
  output: string
  metadata: string
  started_at: number
  finished_at: number
  duration_ms: number
}

export interface ChatTrace {
  session_id: string
  message_id: string
  agent: string
  model_provider: string
  model_id: string
  prompt_text: string
  prompt_length: number
  timestamp: number
}

export interface DiffTrace {
  session_id: string
  file: string
  before: string
  after: string
  additions: number
  deletions: number
  timestamp: number
}

export interface ApiTracePayload {
  id: string
  timestamp: number
  session_id: string
  event_type: string
  payload: Record<string, unknown>
}

export interface PluginConfig {
  dbPath: string
  apiUrl: string
  apiKey?: string
  batchSize: number
  flushIntervalMs: number
  enabled: boolean
}