import { afterEach, describe, expect, it, vi } from "vitest"
import { logger } from "@/lib/logger"

function capture(level: "error" | "warn" | "info") {
  const method = level === "info" ? "log" : level
  return vi.spyOn(console, method).mockImplementation(() => {})
}

afterEach(() => {
  vi.restoreAllMocks()
})

function parse(spy: ReturnType<typeof capture>) {
  expect(spy).toHaveBeenCalledTimes(1)
  return JSON.parse(spy.mock.calls[0][0] as string)
}

describe("logger", () => {
  it("writes one JSON object per line with level, message and time", () => {
    const spy = capture("info")
    logger.info("Booking confirmed", { bookingId: "abc" })
    const entry = parse(spy)
    expect(entry.level).toBe("info")
    expect(entry.message).toBe("Booking confirmed")
    expect(entry.bookingId).toBe("abc")
    expect(Number.isNaN(Date.parse(entry.time))).toBe(false)
  })

  it("redacts anything that looks like a credential", () => {
    const spy = capture("error")
    logger.error("Login failed", {
      email: "person@example.com",
      password: "hunter2",
      apiKey: "sk_live_secret",
      authorization: "Bearer abc",
      cookie: "session=abc",
      client_secret: "cs_secret",
      password_hash: "deadbeef",
      nested: { STRIPE_SECRET_KEY: "sk_live_nested", safe: "kept" },
    })
    const entry = parse(spy)

    expect(entry.email).toBe("person@example.com")
    for (const key of ["password", "apiKey", "authorization", "cookie", "client_secret", "password_hash"]) {
      expect(entry[key]).toBe("[redacted]")
    }
    expect(entry.nested.STRIPE_SECRET_KEY).toBe("[redacted]")
    expect(entry.nested.safe).toBe("kept")

    // Belt and braces: no secret value survives anywhere in the line.
    const line = spy.mock.calls[0][0] as string
    for (const secret of ["hunter2", "sk_live_secret", "sk_live_nested", "cs_secret", "deadbeef"]) {
      expect(line).not.toContain(secret)
    }
  })

  it("keeps an error's message and stack so a failure stays diagnosable", () => {
    const spy = capture("error")
    logger.error("Webhook failed", { error: new Error("signature mismatch") })
    const entry = parse(spy)
    expect(entry.error.name).toBe("Error")
    expect(entry.error.message).toBe("signature mismatch")
    expect(typeof entry.error.stack).toBe("string")
  })

  it("survives a circular object instead of throwing inside the logger", () => {
    const spy = capture("error")
    const circular: Record<string, unknown> = { name: "loop" }
    circular.self = circular
    expect(() => logger.error("Circular", { circular })).not.toThrow()
    const entry = parse(spy)
    expect(entry.message).toBe("Circular")
  })

  it("routes each level to the matching console method", () => {
    const warn = capture("warn")
    logger.warn("Careful", {})
    expect(warn).toHaveBeenCalledTimes(1)
    expect(parse(warn).level).toBe("warn")
  })
})
