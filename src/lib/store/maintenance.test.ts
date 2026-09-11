import { beforeEach, describe, expect, it, vi } from "vitest"

const queryMock = vi.hoisted(() => vi.fn())
const releaseMock = vi.hoisted(() => vi.fn())
const pruneMock = vi.hoisted(() => vi.fn())
const infoMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({ query: queryMock }))
vi.mock("@/lib/store/sessionStore", () => ({ releaseExpiredBookingHolds: releaseMock, pruneUnscheduledSlots: pruneMock }))
vi.mock("@/lib/logger", () => ({ logger: { info: infoMock, warn: vi.fn(), error: vi.fn() } }))

const { runMaintenance } = await import("@/lib/store/maintenance")

/** The statement text for whichever DELETE touched the named table. */
function statementFor(table: string): string {
  const call = queryMock.mock.calls.find(([sql]) => String(sql).includes(table))
  return call ? String(call[0]) : ""
}

function paramsFor(table: string): unknown[] {
  const call = queryMock.mock.calls.find(([sql]) => String(sql).includes(table))
  return call ? (call[1] as unknown[]) : []
}

beforeEach(() => {
  queryMock.mockReset()
  releaseMock.mockReset()
  pruneMock.mockReset()
  infoMock.mockReset()
  queryMock.mockResolvedValue({ rowCount: 0, rows: [] })
  releaseMock.mockResolvedValue(0)
  pruneMock.mockResolvedValue(0)
})

describe("runMaintenance", () => {
  it("releases expired holds and prunes all three spent tables", async () => {
    await runMaintenance()

    expect(releaseMock).toHaveBeenCalledTimes(1)
    expect(statementFor("stripe_webhook_events")).toContain("DELETE")
    expect(statementFor("customer_session_access")).toContain("DELETE")
    expect(statementFor("request_rate_limits")).toContain("DELETE")
  })

  it("reports what each step actually removed", async () => {
    releaseMock.mockResolvedValue(2)
    queryMock
      .mockResolvedValueOnce({ rowCount: 7, rows: [] })
      .mockResolvedValueOnce({ rowCount: 3, rows: [] })
      .mockResolvedValueOnce({ rowCount: 11, rows: [] })

    expect(await runMaintenance()).toEqual({
      holdsReleased: 2,
      slotsPruned: 0,
      webhookEventsPruned: 7,
      accessTokensPruned: 3,
      rateLimitsPruned: 11,
    })
  })

  it("treats a null rowCount as nothing removed", async () => {
    queryMock.mockResolvedValue({ rowCount: null, rows: [] })
    const result = await runMaintenance()
    expect(result.webhookEventsPruned).toBe(0)
    expect(result.rateLimitsPruned).toBe(0)
  })

  // Stripe retries a failed webhook for up to three days, and this table is what
  // stops a retry being processed twice. Pruning inside that window would reopen
  // the double-charge the ledger exists to prevent.
  it("keeps webhook events well beyond Stripe's three-day retry window", async () => {
    await runMaintenance()
    const days = Number(paramsFor("stripe_webhook_events")[0])
    expect(days).toBeGreaterThanOrEqual(7)
    expect(statementFor("stripe_webhook_events")).toContain("days")
  })

  it("only prunes rows already past their own expiry", async () => {
    await runMaintenance()
    expect(statementFor("customer_session_access")).toContain("expires_at <")
    expect(statementFor("request_rate_limits")).toContain("window_started_at <")
  })

  it("stays silent when a quiet database had nothing to clean", async () => {
    await runMaintenance()
    expect(infoMock).not.toHaveBeenCalled()
  })

  it("logs once when it did remove something", async () => {
    releaseMock.mockResolvedValue(1)
    await runMaintenance()
    expect(infoMock).toHaveBeenCalledTimes(1)
  })
})
