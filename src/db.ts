import Database from "better-sqlite3"
import { randomUUID } from "crypto"
import type {
  PluginConfig,
  ToolTrace,
  ChatTrace,
  DiffTrace,
  TraceRecord,
  ApiTracePayload,
} from "./types.js"

export class TraceDB {
  private db: Database.Database
  private insertTrace!: Database.Statement
  private insertTool!: Database.Statement
  private insertChat!: Database.Statement
  private insertDiff!: Database.Statement
  private getUnsynced!: Database.Statement
  private markSynced!: Database.Statement

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma("journal_mode = WAL")
    this.db.pragma("foreign_keys = ON")
    this.init()
    this.prepare()
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        synced INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS tool_traces (
        id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        args TEXT NOT NULL,
        output TEXT NOT NULL,
        metadata TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        synced INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS chat_traces (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        agent TEXT NOT NULL,
        model_provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        prompt_text TEXT NOT NULL,
        prompt_length INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        synced INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS diff_traces (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        file TEXT NOT NULL,
        before TEXT NOT NULL,
        after TEXT NOT NULL,
        additions INTEGER NOT NULL,
        deletions INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        synced INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_traces_session ON traces(session_id);
      CREATE INDEX IF NOT EXISTS idx_traces_synced ON traces(synced);
      CREATE INDEX IF NOT EXISTS idx_tool_traces_session ON tool_traces(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_traces_synced ON tool_traces(synced);
      CREATE INDEX IF NOT EXISTS idx_chat_traces_session ON chat_traces(session_id);
      CREATE INDEX IF NOT EXISTS idx_chat_traces_synced ON chat_traces(synced);
      CREATE INDEX IF NOT EXISTS idx_diff_traces_session ON diff_traces(session_id);
      CREATE INDEX IF NOT EXISTS idx_diff_traces_synced ON diff_traces(synced);
    `)
  }

  private prepare() {
    this.insertTrace = this.db.prepare(`
      INSERT INTO traces (id, timestamp, session_id, event_type, payload, synced)
      VALUES (?, ?, ?, ?, ?, 0)
    `)
    this.insertTool = this.db.prepare(`
      INSERT INTO tool_traces (id, call_id, session_id, message_id, tool, args, output, metadata, started_at, finished_at, duration_ms, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `)
    this.insertChat = this.db.prepare(`
      INSERT INTO chat_traces (id, session_id, message_id, agent, model_provider, model_id, prompt_text, prompt_length, timestamp, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `)
    this.insertDiff = this.db.prepare(`
      INSERT INTO diff_traces (id, session_id, file, before, after, additions, deletions, timestamp, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `)
    this.getUnsynced = this.db.prepare(`
      SELECT id, timestamp, session_id, event_type, payload, synced, created_at
      FROM traces WHERE synced = 0 ORDER BY created_at ASC LIMIT ?
    `)
    this.markSynced = this.db.prepare(`UPDATE traces SET synced = 1 WHERE id = ?`)
  }

  insertToolTrace(trace: ToolTrace): void {
    this.insertTool.run(
      randomUUID(),
      trace.call_id,
      trace.session_id,
      trace.message_id,
      trace.tool,
      trace.args,
      trace.output,
      trace.metadata,
      trace.started_at,
      trace.finished_at,
      trace.duration_ms,
    )
  }

  insertChatTrace(trace: ChatTrace): void {
    this.insertChat.run(
      randomUUID(),
      trace.session_id,
      trace.message_id,
      trace.agent,
      trace.model_provider,
      trace.model_id,
      trace.prompt_text,
      trace.prompt_length,
      trace.timestamp,
    )
  }

  insertDiffTrace(trace: DiffTrace): void {
    this.insertDiff.run(
      randomUUID(),
      trace.session_id,
      trace.file,
      trace.before,
      trace.after,
      trace.additions,
      trace.deletions,
      trace.timestamp,
    )
  }

  insertEvent(sessionId: string, eventType: string, payload: Record<string, unknown>): void {
    this.insertTrace.run(
      randomUUID(),
      Date.now(),
      sessionId,
      eventType,
      JSON.stringify(payload),
    )
  }

  getUnsyncedTraces(limit: number): TraceRecord[] {
    return this.getUnsynced.all(limit) as TraceRecord[]
  }

  markTraceSynced(id: string): void {
    this.markSynced.run(id)
  }

  getToolTracesForSync(limit: number): ToolTrace[] {
    const rows = this.db.prepare(
      `SELECT * FROM tool_traces WHERE synced = 0 ORDER BY created_at ASC LIMIT ?`
    ).all(limit) as ToolTrace[]
    return rows
  }

  markToolSynced(id: string): void {
    this.db.prepare(`UPDATE tool_traces SET synced = 1 WHERE id = ?`).run(id)
  }

  getChatTracesForSync(limit: number): ChatTrace[] {
    const rows = this.db.prepare(
      `SELECT * FROM chat_traces WHERE synced = 0 ORDER BY created_at ASC LIMIT ?`
    ).all(limit) as ChatTrace[]
    return rows
  }

  markChatSynced(id: string): void {
    this.db.prepare(`UPDATE chat_traces SET synced = 1 WHERE id = ?`).run(id)
  }

  getDiffTracesForSync(limit: number): DiffTrace[] {
    const rows = this.db.prepare(
      `SELECT * FROM diff_traces WHERE synced = 0 ORDER BY created_at ASC LIMIT ?`
    ).all(limit) as DiffTrace[]
    return rows
  }

  markDiffSynced(id: string): void {
    this.db.prepare(`UPDATE diff_traces SET synced = 1 WHERE id = ?`).run(id)
  }

  close(): void {
    this.db.close()
  }
}