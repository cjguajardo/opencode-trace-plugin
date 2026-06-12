import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import type { Event } from "@opencode-ai/sdk"
import { randomUUID } from "crypto"
import { TraceDB } from "./db.js"
import { SyncWorker } from "./sync.js"
import type {
  PluginConfig,
  ToolTrace,
  ChatTrace,
  DiffTrace,
} from "./types.js"

function loadConfig(input: PluginInput): PluginConfig {
  const env = (key: string, fallback: string) =>
    process.env[key] ?? fallback

  return {
    dbPath: env("TRACE_DB_PATH", "./trace.db"),
    apiUrl: env("TRACE_API_URL", ""),
    apiKey: process.env.TRACE_API_KEY || undefined,
    batchSize: parseInt(env("TRACE_BATCH_SIZE", "50"), 10),
    flushIntervalMs: parseInt(env("TRACE_FLUSH_INTERVAL_MS", "5000"), 10),
    enabled: process.env.TRACE_ENABLED !== "false",
  }
}

export const TracePlugin: Plugin = async (input: PluginInput) => {
  const config = loadConfig(input)

  if (!config.enabled) {
    return {}
  }

  const db = new TraceDB(config.dbPath)
  const sync = new SyncWorker(config)

  const log = (level: string, msg: string, extra?: Record<string, unknown>) => {
    const entry = extra ? `${msg} ${JSON.stringify(extra)}` : msg
    if (input.client) {
      // best-effort logging
    }
  }

  // Tool call tracking: map callID -> started_at
  const toolTimings = new Map<string, number>()

  sync.start(
    (limit) => db.getUnsyncedTraces(limit),
    (limit) => db.getToolTracesForSync(limit),
    (limit) => db.getChatTracesForSync(limit),
    (limit) => db.getDiffTracesForSync(limit),
    (id) => db.markTraceSynced(id),
    (id) => db.markToolSynced(id),
    (id) => db.markChatSynced(id),
    (id) => db.markDiffSynced(id),
    (msg) => log("info", msg),
  )

  const safe = <T extends unknown[]>(
    name: string,
    fn: (...args: T) => Promise<void> | void,
  ) =>
    async (...args: T) => {
      try {
        await fn(...args)
      } catch (err) {
        log("error", `trace: unhandled error in ${name}`, {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

  return {
    "tool.execute.before": safe("tool.execute.before", async (input) => {
      toolTimings.set(input.callID, Date.now())
    }),

    "tool.execute.after": safe("tool.execute.after", async (input, output) => {
      const startedAt = toolTimings.get(input.callID) ?? Date.now()
      toolTimings.delete(input.callID)
      const finishedAt = Date.now()

      const trace: ToolTrace = {
        call_id: input.callID,
        session_id: input.sessionID,
        message_id: "", // not available in after hook
        tool: input.tool,
        args: JSON.stringify(input.args),
        output: typeof output.output === "string" ? output.output : JSON.stringify(output.output),
        metadata: JSON.stringify(output.metadata ?? {}),
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: finishedAt - startedAt,
      }

      db.insertToolTrace(trace)
    }),

    "chat.message": safe("chat.message", async (input, output) => {
      const promptText = output.parts
        .map((part) => {
          switch (part.type) {
            case "text": return part.text
            case "file": return part.filename ?? part.url ?? ""
            case "agent": return part.name ?? ""
            case "subtask": return part.description ?? ""
            default: return ""
          }
        })
        .filter(Boolean)
        .join("\n")

      const trace: ChatTrace = {
        session_id: input.sessionID,
        message_id: input.messageID ?? randomUUID(),
        agent: input.agent ?? "unknown",
        model_provider: input.model?.providerID ?? "unknown",
        model_id: input.model?.modelID ?? "unknown",
        prompt_text: promptText,
        prompt_length: promptText.length,
        timestamp: Date.now(),
      }

      db.insertChatTrace(trace)
    }),

    event: safe("event", async ({ event }) => {
      const sessionId = extractSessionId(event)
      if (!sessionId) return

      switch (event.type) {
        case "session.diff": {
          for (const diff of event.properties.diff) {
            const trace: DiffTrace = {
              session_id: sessionId,
              file: diff.file,
              before: diff.before,
              after: diff.after,
              additions: diff.additions,
              deletions: diff.deletions,
              timestamp: Date.now(),
            }
            db.insertDiffTrace(trace)
          }
          break
        }

        case "session.created":
        case "session.deleted":
        case "session.idle":
        case "session.error":
        case "session.status":
        case "session.compacted":
        case "file.edited":
        case "command.executed":
        case "permission.updated":
        case "permission.replied":
        case "message.updated":
        case "message.part.updated":
        case "installation.updated":
        case "installation.update-available": {
          const payload = serializeEvent(event)
          db.insertEvent(sessionId, event.type, payload)
          break
        }
      }
    }),

    config: async (cfg) => {
      // Allow runtime config tweaks if needed
    },
  }
}

function extractSessionId(event: Event): string | null {
  const props = event.properties as Record<string, unknown>
  if (typeof props.sessionID === "string") return props.sessionID
  return null
}

function serializeEvent(event: Event): Record<string, unknown> {
  const obj: Record<string, unknown> = { type: event.type }
  const props = event.properties as Record<string, unknown>
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === "object" && value !== null) {
      obj[key] = JSON.parse(JSON.stringify(value))
    } else {
      obj[key] = value
    }
  }
  return obj
}