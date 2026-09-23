import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SesionCompra } from "@/lib/types"
import {
  invoiceMessage,
  productLine,
  sendInvoiceSummary,
  sendProductQuantityChanged,
  sendProductRemoved,
  sendProductUpdate,
  sendTemplate,
  sendText,
} from "@/lib/whatsapp/send"

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

// A cart edit is not only an addition. Until these existed the chat kept
// showing an item the seller had already taken out, and a line total that had
// since changed -- so the customer read a cart that was not theirs, which is
// precisely what the echo exists to save them from checking elsewhere.
describe("corrections to the cart", () => {
  function bodySent(fetchMock: ReturnType<typeof stubFetch>): string {
    return JSON.parse(fetchMock.mock.calls[0][1].body).text.body
  }

  it("says a product was removed, naming it", async () => {
    const fetchMock = stubFetch(200, { messages: [{ id: "wamid.removed" }] })
    const outcome = await sendProductRemoved("+57 300 123 4567", "Tenis Nike Pegasus", 1)
    expect(outcome.status).toBe("sent")
    expect(bodySent(fetchMock)).toBe("Removed from your cart: Tenis Nike Pegasus")
  })

  it("keeps the quantity in a removal, so the customer knows what left the cart", async () => {
    const fetchMock = stubFetch(200, { messages: [{ id: "wamid.removed2" }] })
    await sendProductRemoved("+57 300 123 4567", "Medias", 3)
    expect(bodySent(fetchMock)).toBe("Removed from your cart: 3 x Medias")
  })

  it("reports the new line total after a quantity change", async () => {
    const fetchMock = stubFetch(200, { messages: [{ id: "wamid.updated" }] })
    const outcome = await sendProductQuantityChanged("+57 300 123 4567", "Chaqueta Windrunner", 68, 2)
    expect(outcome.status).toBe("sent")
    expect(bodySent(fetchMock)).toBe("Updated in your cart: 2 x Chaqueta Windrunner — $136.00 USD")
  })

  // The approved product template says an item was *added*. Falling back to it
  // for a removal would tell the customer the opposite of what happened, so a
  // correction is free text or nothing.
  it("never falls back to the product template when the window is shut", async () => {
    process.env.WHATSAPP_TEMPLATE_PRODUCT = "producto_agregado"
    const fetchMock = stubFetch(400, { error: { code: 131047, message: "Re-engagement message" } })
    const outcome = await sendProductRemoved("+57 300 123 4567", "Gorra", 1)
    expect(outcome.status).toBe("failed")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("refuses a number that was never normalised, rather than messaging a stranger", async () => {
    const fetchMock = stubFetch(200, { messages: [{ id: "never" }] })
    const outcome = await sendProductRemoved("03241452724", "Gorra", 1)
    expect(outcome.status).toBe("failed")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// The echo carries line items only. When the seller closes the session the
// customer receives the whole invoice -- the figures on the approved screen 4
// design -- and the link to pay it, without opening the order page.
describe("invoice at close", () => {
  // Screen 4's own figures: $163 subtotal, 7% tax, 15% commission, $198.86.
  function closedSession(overrides: Partial<SesionCompra> = {}): SesionCompra {
    return {
      productos: [
        { id: "p1", nombre: "Tenis Nike Pegasus", precio: 95, cantidad: 1, addedAt: new Date() },
        { id: "p2", nombre: "Medias", precio: 34, cantidad: 2, addedAt: new Date() },
      ],
      subtotal: 163,
      impuesto: 11.41,
      comision: 24.45,
      total: 198.86,
      tasaImpuesto: 0.07,
      tasaComision: 0.15,
      porcentajeInicial: 65,
      ...overrides,
    } as SesionCompra
  }

  const LINK = "https://brash3-d.vercel.app/session/s1?token=abc"

  it("lists every product, the tax, the commission, the total and the split", () => {
    expect(invoiceMessage(closedSession(), LINK)).toBe([
      "Brash3D: your invoice is ready 🧾",
      "",
      "• Tenis Nike Pegasus — $95.00",
      "• 2 x Medias — $68.00",
      "",
      "Subtotal: $163.00",
      "Florida tax (7%): $11.41",
      "Brash3D commission (15%): $24.45",
      "*Invoice total: $198.86 USD*",
      "",
      "Up-front payment (65%): $129.26",
      "Balance on delivery (35%): $69.60",
      "",
      "Confirm your delivery address and make your up-front payment here:",
      LINK,
    ].join("\n"))
  })

  // The two charges are derived by subtraction, so they add up to the invoice
  // exactly -- the message must quote the same figures Stripe will charge.
  it("quotes a split that adds up to the total", () => {
    const text = invoiceMessage(closedSession({ total: 100.01, porcentajeInicial: 85 }), LINK)
    expect(text).toContain("Up-front payment (85%): $85.01")
    expect(text).toContain("Balance on delivery (15%): $15.00")
  })

  it("shows no balance for an order paid 100% up front", () => {
    const text = invoiceMessage(closedSession({ porcentajeInicial: 100 }), LINK)
    expect(text).toContain("Paid in full up front (100%): $198.86")
    expect(text).not.toContain("Balance on delivery")
  })

  it("writes the commission the seller agreed, not a default", () => {
    expect(invoiceMessage(closedSession({ tasaComision: 0.1 }), LINK)).toContain("Brash3D commission (10%)")
    expect(invoiceMessage(closedSession({ tasaImpuesto: 0.065 }), LINK)).toContain("Florida tax (6.5%)")
  })

  it("writes Spanish by default", () => {
    delete process.env.WHATSAPP_MESSAGE_LOCALE
    const text = invoiceMessage(closedSession(), LINK)
    expect(text).toContain("Brash3D: tu factura está lista")
    expect(text).toContain("Impuesto Florida (7%): $11.41")
    expect(text).toContain("Comisión Brash3D (15%): $24.45")
    expect(text).toContain("Pago inicial (65%): $129.26")
    expect(text).toContain("Saldo al entregar (35%): $69.60")
  })

  it("sends it as free text", async () => {
    const fetchMock = stubFetch(200, { messages: [{ id: "wamid.INVOICE" }] })
    const outcome = await sendInvoiceSummary("+57 300 123 4567", closedSession(), LINK)
    expect(outcome).toEqual({ status: "sent", messageId: "wamid.INVOICE" })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.type).toBe("text")
    expect(body.text.body).toContain(LINK)
  })
})
