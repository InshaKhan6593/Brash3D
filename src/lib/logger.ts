import "server-only"

type Level = "error" | "warn" | "info"

export interface LogFields {
  [key: string]: unknown
}

// Anything whose key looks like a credential is replaced before the line is
// written, so a stray context object can never leak a secret into the logs.
const REDACTED_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|client_secret|salt|hash/i

function serialise(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      // A stack is what makes a 3am failure diagnosable; keep it on errors only.
      stack: value.stack,
      ...(value.cause ? { cause: serialise(value.cause, depth + 1) } : {}),
    }
  }
  if (Array.isArray(value)) {
    return depth > 3 ? "[deep array]" : value.map((item) => serialise(item, depth + 1))
  }
  if (value && typeof value === "object") {
    if (depth > 3) return "[deep object]"
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      result[key] = REDACTED_KEY.test(key) ? "[redacted]" : serialise(item, depth + 1)
    }
    return result
  }
  return value
}

function emit(level: Level, message: string, fields?: LogFields): void {
  const entry = {
    level,
    message,
    time: new Date().toISOString(),
    ...(fields ? (serialise(fields) as LogFields) : {}),
  }

  // One JSON object per line: readable in a terminal, ingestible by any
  // aggregator (Vercel, CloudWatch, Datadog) without a vendor SDK.
  let line: string
  try {
    line = JSON.stringify(entry)
  } catch {
    line = JSON.stringify({ level, message, time: entry.time, note: "log fields were not serialisable" })
  }

  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}

export const logger = {
  error(message: string, fields?: LogFields) {
    emit("error", message, fields)
  },
  warn(message: string, fields?: LogFields) {
    emit("warn", message, fields)
  },
  info(message: string, fields?: LogFields) {
    emit("info", message, fields)
  },
}
