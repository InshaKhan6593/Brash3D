import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { productLine, sendProductUpdate, sendTemplate, sendText } from "@/lib/whatsapp/send"

const ORIGINAL = { ...process.env }

beforeEach(() => {
  process.env.WHATSAPP_PHONE_NUMBER_ID = "1146697075204745"
  process.env.WHATSAPP_CLOUD_API_TOKEN = "EAAtest"
  process.env.WHATSAPP_API_VERSION = "v23.0"
  // English while the team is testing; Spanish is the default and the shipping
  // copy, pinned by its own test below.
  process.env.WHATSAPP_MESSAGE_LOCALE = "en"
})

afterEach(() => {
  process.env = { ...ORIGINAL }
  vi.unstubAllGlobals()
})

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

describe("product line", () => {
  it("names the product and its price", () => {
    expect(productLine("Tenis Nike Pegasus", 95, 1)).toBe("Added to your cart: Tenis Nike Pegasus — $95.00 USD")
  })

  // The customer is looking at the item on a video call; what they cannot see
  // is how many the seller rang up, or what that comes to.
  it("shows the line total when more than one was added", () => {
    expect(productLine("Chaqueta Windrunner", 68, 2)).toBe("Added to your cart: 2 x Chaqueta Windrunner — $136.00 USD")
  })

  it("always writes money to the cent", () => {
    expect(productLine("Gorra", 9.5, 1)).toBe("Added to your cart: Gorra — $9.50 USD")
    expect(productLine("Medias", 0.1, 3)).toBe("Added to your cart: 3 x Medias — $0.30 USD")
  })

  // Spanish is what ships: the buyers are Colombian and every other
  // customer-facing surface is Spanish first.
  it("writes Spanish by default", () => {
    delete process.env.WHATSAPP_MESSAGE_LOCALE
    expect(productLine("Tenis Nike Pegasus", 95, 1)).toBe("Agregado a tu carrito: Tenis Nike Pegasus — $95.00 USD")
  })
})

describe("sending", () => {
  it("sends a text message and returns Meta's message id", async () => {
    const fetchMock = stubFetch(200, { messages: [{ id: "wamid.SENT" }] })
    const outcome = await sendText("+57 300 123 4567", "Added to your cart: Gorra - $9.50")

    expect(outcome).toEqual({ status: "sent", messageId: "wamid.SENT" })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://graph.facebook.com/v23.0/1146697075204745/messages")
    const body = JSON.parse((init as { body: string }).body)
    // Punctuation the number was typed with would be rejected by Meta.
    expect(body.to).toBe("573001234567")
    expect(body.type).toBe("text")
    expect(body.text.preview_url).toBe(false)
  })

  /*
   * The one failure the seller can act on: the customer has not messaged the
   * business, so nothing can reach them until they tap the WhatsApp button on
   * their order page. Distinguished from every other failure because it is the
   * difference between a prompt and a shrug.
   */
  it("reports a closed window distinctly", async () => {
    stubFetch(400, { error: { code: 131047, message: "Re-engagement message" } })
    const outcome = await sendText("573001234567", "hola")
    expect(outcome).toEqual({
      status: "failed", code: 131047, detail: "Re-engagement message", windowClosed: true,
    })
  })

  it("reports other Meta rejections without claiming the window is closed", async () => {
    stubFetch(400, { error: { code: 131030, message: "Recipient phone number not in allowed list" } })
    const outcome = await sendText("573001234567", "hola")
    expect(outcome).toMatchObject({ status: "failed", code: 131030, windowClosed: false })
  })

  /*
   * Specification 7.1: "If the WhatsApp send fails, don't roll back the cart
   * insert." Nothing here may throw, or an unreachable Meta would cost the
   * seller a product on a live invoice.
   */
  it("never throws when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")))
    const outcome = await sendText("573001234567", "hola")
    expect(outcome).toEqual({ status: "failed", detail: "ECONNRESET", windowClosed: false })
  })

  it("never throws when Meta answers with something that is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 502, json: async () => { throw new Error("not json") },
    }))
    const outcome = await sendText("573001234567", "hola")
    expect(outcome).toMatchObject({ status: "failed", detail: "HTTP 502" })
  })

  // Unconfigured is not a failure: the integration is optional throughout, and
  // the web cart carries the session on its own.
  it("is inert with no credentials, without calling Meta", async () => {
    delete process.env.WHATSAPP_PHONE_NUMBER_ID
    delete process.env.WHATSAPP_CLOUD_API_TOKEN
    const fetchMock = stubFetch(200, {})
    expect(await sendText("573001234567", "hola")).toEqual({ status: "disabled" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses a customer with no usable phone number, without calling Meta", async () => {
    const fetchMock = stubFetch(200, {})
    const outcome = await sendText("sin teléfono", "hola")
    expect(outcome).toMatchObject({ status: "failed", windowClosed: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("templates", () => {
  it("sends an approved template with its body parameters", async () => {
    process.env.WHATSAPP_TEMPLATE_LANGUAGE = "es"
    const fetchMock = stubFetch(200, { messages: [{ id: "wamid.TPL" }] })
    const outcome = await sendTemplate("+57 300 123 4567", "reserva_confirmada", ["Camila", "viernes 8:00 PM"])

    expect(outcome).toEqual({ status: "sent", messageId: "wamid.TPL" })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.type).toBe("template")
    expect(body.template.name).toBe("reserva_confirmada")
    // Meta matches the language exactly; `es` and `es_ES` are different templates.
    expect(body.template.language).toEqual({ code: "es" })
    expect(body.template.components[0]).toEqual({
      type: "body",
      parameters: [{ type: "text", text: "Camila" }, { type: "text", text: "viernes 8:00 PM" }],
    })
  })

  it("carries the order link as a dynamic URL button", async () => {
    const fetchMock = stubFetch(200, { messages: [{ id: "wamid.TPL" }] })
    await sendTemplate("573001234567", "reserva_confirmada", ["Camila"], "abc123?token=xyz")

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    const button = body.template.components.find((c: { type: string }) => c.type === "button")
    expect(button).toEqual({
      type: "button", sub_type: "url", index: "0",
      parameters: [{ type: "text", text: "abc123?token=xyz" }],
    })
  })

  it("omits components entirely for a template with no variables", async () => {
    const fetchMock = stubFetch(200, { messages: [{ id: "wamid.HELLO" }] })
    await sendTemplate("573001234567", "hello_world")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).template.components).toBeUndefined()
  })
})

/*
 * The customer should not have to tap anything to receive their cart. Free text
 * is tried first because inside an open window it is free and reads like an
 * ordinary message; the template is what covers the customer who never wrote
 * back.
 */
describe("product update routing", () => {
  it("sends free text when the window is open, and no template", async () => {
    process.env.WHATSAPP_TEMPLATE_PRODUCT = "producto_agregado"
    const fetchMock = stubFetch(200, { messages: [{ id: "wamid.FREE" }] })

    expect(await sendProductUpdate("573001234567", "Tenis Nike Pegasus", 95, 1))
      .toEqual({ status: "sent", messageId: "wamid.FREE" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).type).toBe("text")
  })

  it("falls back to the template when the window is closed", async () => {
    process.env.WHATSAPP_TEMPLATE_PRODUCT = "producto_agregado"
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 131047, message: "Re-engagement message" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.TPL" }] }) })
    vi.stubGlobal("fetch", fetchMock)

    expect(await sendProductUpdate("573001234567", "Chaqueta Windrunner", 68, 2))
      .toEqual({ status: "sent", messageId: "wamid.TPL" })

    const template = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(template.template.name).toBe("producto_agregado")
    // The quantity belongs in the product parameter, since a template's shape
    // is fixed at approval and cannot grow a field per send.
    expect(template.template.components[0].parameters).toEqual([
      { type: "text", text: "2 x Chaqueta Windrunner" },
      { type: "text", text: "136.00" },
    ])
  })

  it("does not fall back for a failure the template cannot fix", async () => {
    process.env.WHATSAPP_TEMPLATE_PRODUCT = "producto_agregado"
    const fetchMock = stubFetch(400, { error: { code: 131030, message: "Recipient phone number not in allowed list" } })

    expect(await sendProductUpdate("573001234567", "Gorra", 9.5, 1))
      .toMatchObject({ status: "failed", code: 131030 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // Before any template has been approved, which is where every project starts.
  it("reports the closed window when no product template is configured", async () => {
    delete process.env.WHATSAPP_TEMPLATE_PRODUCT
    const fetchMock = stubFetch(400, { error: { code: 131047, message: "Re-engagement message" } })

    expect(await sendProductUpdate("573001234567", "Gorra", 9.5, 1))
      .toMatchObject({ status: "failed", windowClosed: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
