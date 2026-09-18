import { randomUUID } from "node:crypto"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { query } from "@/lib/db"
import { recordInboundMessage, toWaId, windowState, WINDOW_HOURS } from "@/lib/store/whatsappStore"

// A number nobody else's test will collide on, cleaned up afterwards.
const ids: string[] = []
function newWaId(): string {
  const id = "57300" + randomUUID().replace(/\D/g, "").slice(0, 7).padEnd(7, "0")
  ids.push(id)
  return id
}

beforeAll(async () => {
  const ready = await query<{ ok: boolean }>(
    "SELECT to_regclass('public.whatsapp_message_windows') IS NOT NULL AS ok"
  )
  if (!ready.rows[0]?.ok) {
    throw new Error("Run `npm run db:migrate` before the store tests")
  }
})

afterEach(async () => {
  if (ids.length) {
    await query("DELETE FROM whatsapp_message_windows WHERE wa_id = ANY($1)", [ids])
    ids.length = 0
  }
})

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000)
}

describe("wa_id normalisation", () => {
  // The same number is written half a dozen ways across a booking form, a
  // seller's typing and Meta's payloads. They all have to reach one row.
  it("reduces every way a number is written to the same id", () => {
    for (const written of ["+57 300 123 4567", "57-300-123-4567", "(57) 300 1234567", "573001234567"]) {
      expect(toWaId(written)).toBe("573001234567")
    }
  })

  it("treats an absent or unusable number as no id at all", () => {
    expect(toWaId(null)).toBe("")
    expect(toWaId(undefined)).toBe("")
    expect(toWaId("")).toBe("")
    expect(toWaId("sin teléfono")).toBe("")
  })
})

describe("customer service window", () => {
  it("is closed for a customer who has never messaged", async () => {
    expect(await windowState(newWaId())).toEqual({ open: false, lastInboundAt: null, expiresAt: null })
  })

  it("opens when the customer messages, and reports when it expires", async () => {
    const waId = newWaId()
    const sentAt = new Date()
    await recordInboundMessage(waId, sentAt, "wamid.ONE")

    const state = await windowState(waId)
    expect(state.open).toBe(true)
    expect(state.lastInboundAt?.getTime()).toBeCloseTo(sentAt.getTime(), -3)
    expect(state.expiresAt!.getTime() - sentAt.getTime()).toBe(WINDOW_HOURS * 60 * 60 * 1000)
  })

  it("is closed again once 24 hours have passed", async () => {
    const waId = newWaId()
    await recordInboundMessage(waId, hoursAgo(WINDOW_HOURS + 1), "wamid.OLD")
    expect((await windowState(waId)).open).toBe(false)
  })

  it("is still open just inside the boundary", async () => {
    const waId = newWaId()
    await recordInboundMessage(waId, hoursAgo(WINDOW_HOURS - 1), "wamid.RECENT")
    expect((await windowState(waId)).open).toBe(true)
  })

  it("extends the window when the customer messages again", async () => {
    const waId = newWaId()
    await recordInboundMessage(waId, hoursAgo(20), "wamid.FIRST")
    await recordInboundMessage(waId, new Date(), "wamid.SECOND")

    const state = await windowState(waId)
    expect(state.open).toBe(true)
    expect(Date.now() - state.lastInboundAt!.getTime()).toBeLessThan(5_000)
  })

  /*
   * Meta redelivers a webhook it believes was not acknowledged, and the retry
   * can arrive after a newer message. Without GREATEST the older timestamp
   * would win and close a window that is genuinely open -- telling the seller
   * to chase a customer who is already in the chat.
   */
  it("never moves backwards when an older delivery is retried", async () => {
    const waId = newWaId()
    const recent = new Date()
    await recordInboundMessage(waId, recent, "wamid.NEW")
    await recordInboundMessage(waId, hoursAgo(30), "wamid.REPLAY")

    const state = await windowState(waId)
    expect(state.open).toBe(true)
    expect(state.lastInboundAt!.getTime()).toBeCloseTo(recent.getTime(), -3)

    const stored = await query<{ last_message_id: string }>(
      "SELECT last_message_id FROM whatsapp_message_windows WHERE wa_id = $1", [waId]
    )
    expect(stored.rows[0].last_message_id).toBe("wamid.NEW")
  })

  it("matches a customer whose number is stored with punctuation", async () => {
    const waId = newWaId()
    await recordInboundMessage(waId, new Date(), "wamid.FORMATTED")
    const formatted = `+${waId.slice(0, 2)} ${waId.slice(2, 5)} ${waId.slice(5)}`
    expect((await windowState(formatted)).open).toBe(true)
  })

  it("records nothing for an unusable number rather than throwing", async () => {
    await expect(recordInboundMessage("", new Date())).resolves.toEqual({ openedWindow: false })
    await expect(recordInboundMessage("not a number", new Date())).resolves.toEqual({ openedWindow: false })
  })
})

// The confirmation the customer gets back is sent on this signal, so it has to
// mean "they have just opened the chat" and not merely "they said something".
// It used to be sent when they tapped the button instead, which told anyone who
// opened WhatsApp and never pressed send that every product would reach them --
// a promise the app could not keep, because Meta's window had not opened.
describe("knowing when a message opened the window", () => {
  it("reports the first message from a number as opening it", async () => {
    const waId = newWaId()
    expect(await recordInboundMessage(waId, new Date(), "wamid.FIRST")).toEqual({ openedWindow: true })
  })

  it("does not report a second message, so the customer is answered once", async () => {
    const waId = newWaId()
    await recordInboundMessage(waId, new Date(), "wamid.ONE")
    expect(await recordInboundMessage(waId, new Date(), "wamid.TWO")).toEqual({ openedWindow: false })
    expect(await recordInboundMessage(waId, new Date(), "wamid.THREE")).toEqual({ openedWindow: false })
  })

  // A customer who books, chats, and comes back days later for the session has
  // let the window lapse. That message reopens it, and is worth answering.
  it("reports a message that reopens a lapsed window", async () => {
    const waId = newWaId()
    const longAgo = new Date(Date.now() - (WINDOW_HOURS + 1) * 60 * 60 * 1000)
    await recordInboundMessage(waId, longAgo, "wamid.OLD")
    expect((await windowState(waId)).open).toBe(false)
    expect(await recordInboundMessage(waId, new Date(), "wamid.NEW")).toEqual({ openedWindow: true })
    expect((await windowState(waId)).open).toBe(true)
  })

  // Meta redelivers a webhook it believes was not acknowledged. A retry must
  // not be mistaken for the customer writing again.
  it("treats a redelivered message as not reopening anything", async () => {
    const waId = newWaId()
    const sentAt = new Date()
    expect(await recordInboundMessage(waId, sentAt, "wamid.DUP")).toEqual({ openedWindow: true })
    expect(await recordInboundMessage(waId, sentAt, "wamid.DUP")).toEqual({ openedWindow: false })
  })
})
