import type {
  PluginConfig,
  TraceRecord,
  ToolTrace,
  ChatTrace,
  DiffTrace,
} from "./types.js"

export class SyncWorker {
  private config: PluginConfig
  private timer: ReturnType<typeof setInterval> | null = null
  private flushing = false

  constructor(config: PluginConfig) {
    this.config = config
  }

  start(
    getUnsyncedTraces: (limit: number) => TraceRecord[],
    getToolTraces: (limit: number) => ToolTrace[],
    getChatTraces: (limit: number) => ChatTrace[],
    getDiffTraces: (limit: number) => DiffTrace[],
    markTraceSynced: (id: string) => void,
    markToolSynced: (id: string) => void,
    markChatSynced: (id: string) => void,
    markDiffSynced: (id: string) => void,
    log: (msg: string) => void,
  ) {
    if (!this.config.apiUrl) return

    this.timer = setInterval(async () => {
      await this.flush(
        getUnsyncedTraces,
        getToolTraces,
        getChatTraces,
        getDiffTraces,
        markTraceSynced,
        markToolSynced,
        markChatSynced,
        markDiffSynced,
        log,
      )
    }, this.config.flushIntervalMs)
  }

  async flush(
    getUnsyncedTraces: (limit: number) => TraceRecord[],
    getToolTraces: (limit: number) => ToolTrace[],
    getChatTraces: (limit: number) => ChatTrace[],
    getDiffTraces: (limit: number) => DiffTrace[],
    markTraceSynced: (id: string) => void,
    markToolSynced: (id: string) => void,
    markChatSynced: (id: string) => void,
    markDiffSynced: (id: string) => void,
    log: (msg: string) => void,
  ): Promise<void> {
    if (this.flushing) return
    this.flushing = true

    try {
      // Sync events
      const records = getUnsyncedTraces(this.config.batchSize)
      for (const record of records) {
        const ok = await this.send(`/traces/events`, {
          id: record.id,
          timestamp: record.timestamp,
          session_id: record.session_id,
          event_type: record.event_type,
          payload: JSON.parse(record.payload),
        })
        if (ok) markTraceSynced(record.id)
      }

      // Sync tool traces
      const tools = getToolTraces(this.config.batchSize)
      for (const tool of tools) {
        const ok = await this.send(`/traces/tools`, tool)
        if (ok) markToolSynced((tool as any).id)
      }

      // Sync chat traces
      const chats = getChatTraces(this.config.batchSize)
      for (const chat of chats) {
        const ok = await this.send(`/traces/chats`, chat)
        if (ok) markChatSynced((chat as any).id)
      }

      // Sync diff traces
      const diffs = getDiffTraces(this.config.batchSize)
      for (const diff of diffs) {
        const ok = await this.send(`/traces/diffs`, diff)
        if (ok) markDiffSynced((diff as any).id)
      }
    } finally {
      this.flushing = false
    }
  }

  private async send(path: string, body: unknown): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.apiUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}