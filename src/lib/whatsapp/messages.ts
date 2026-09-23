import "server-only"

import { messageLocale } from "@/lib/whatsapp/config"

/**
 * What the customer reads in WhatsApp.
 *
 * Separate from `src/lib/i18n`, which serves the browser: those strings are
 * chosen by a cookie the reader controls, and WhatsApp has no such thing. The
 * server decides here, from `WHATSAPP_MESSAGE_LOCALE`.
 *
 * Spanish is the default and the shipping copy -- the buyers are Colombian, and
 * every other customer-facing surface is Spanish first. English exists so the
 * people building and testing this can read what they are sending.
 */
interface WhatsAppCopy {
  productAdded: (label: string, amount: string) => string
  /**
   * A correction, not an addition. Without it the chat keeps showing an item
   * the seller has already taken out of the cart, and the customer reads a
   * total they are not being charged -- the one thing the echo exists to
   * prevent them having to check on another screen.
   */
  productRemoved: (label: string) => string
  /** The new line total after a quantity change, replacing the earlier one. */
  productUpdated: (label: string, amount: string) => string
  updatesEnabled: string
  bookingConfirmation: (name: string, when: string, outlet: string, link: string) => string
  /**
   * The whole invoice, sent once when the seller closes the session. The echo
   * only ever carried line items; tax, commission and the payment split exist
   * from this moment on, and the customer should not have to open the order
   * page to learn what they owe.
   */
  invoice: (invoice: InvoiceCopy) => string
}

/** Every figure pre-formatted, so the copy decides wording and order only. */
export interface InvoiceCopy {
  lines: Array<{ label: string; amount: string }>
  subtotal: string
  taxRate: string
  tax: string
  commissionRate: string
  commission: string
  total: string
  initialPercentage: string
  initial: string
  /** Absent when the order is paid 100% up front: there is no balance to show. */
  balance?: { percentage: string; amount: string }
  link: string
}

function invoiceLines(lines: InvoiceCopy["lines"]): string[] {
  return lines.map(({ label, amount }) => `• ${label} — $${amount}`)
}

const ES: WhatsAppCopy = {
  productAdded: (label, amount) => `Agregado a tu carrito: ${label} — $${amount} USD`,
  productRemoved: (label) => `Quitado de tu carrito: ${label}`,
  productUpdated: (label, amount) => `Actualizado en tu carrito: ${label} — $${amount} USD`,
  updatesEnabled: "Brash3D: listo. Te enviaremos aquí cada producto que agreguemos a tu carrito.",
  bookingConfirmation: (name, when, outlet, link) => [
    `Hola ${name}, tu sesión de compra en vivo con Brash3D está confirmada.`,
    "",
    `Cita: ${when}`,
    `Outlet: ${outlet}`,
    "",
    "Guarda este chat. Aquí te llegará tu carrito en vivo durante la videollamada.",
    link,
  ].join("\n"),
  invoice: (invoice) => [
    "Brash3D: tu factura está lista 🧾",
    "",
    ...invoiceLines(invoice.lines),
    "",
    `Subtotal: $${invoice.subtotal}`,
    `Impuesto Florida (${invoice.taxRate}): $${invoice.tax}`,
    `Comisión Brash3D (${invoice.commissionRate}): $${invoice.commission}`,
    `*Total factura: $${invoice.total} USD*`,
    "",
    ...(invoice.balance
      ? [
        `Pago inicial (${invoice.initialPercentage}): $${invoice.initial}`,
        `Saldo al entregar (${invoice.balance.percentage}): $${invoice.balance.amount}`,
        "",
        "Confirma tu dirección de entrega y haz tu pago inicial aquí:",
      ]
      : [
        `Pago total por adelantado (${invoice.initialPercentage}): $${invoice.initial}`,
        "",
        "Confirma tu dirección de entrega y haz tu pago aquí:",
      ]),
    invoice.link,
  ].join("\n"),
}

const EN: WhatsAppCopy = {
  productAdded: (label, amount) => `Added to your cart: ${label} — $${amount} USD`,
  productRemoved: (label) => `Removed from your cart: ${label}`,
  productUpdated: (label, amount) => `Updated in your cart: ${label} — $${amount} USD`,
  updatesEnabled: "Brash3D: done. We will send every product we add to your cart here.",
  bookingConfirmation: (name, when, outlet, link) => [
    `Hi ${name}, your Brash3D live shopping session is confirmed.`,
    "",
    `Appointment: ${when}`,
    `Outlet: ${outlet}`,
    "",
    "Keep this chat. Your live cart arrives here during the video call.",
    link,
  ].join("\n"),
  invoice: (invoice) => [
    "Brash3D: your invoice is ready 🧾",
    "",
    ...invoiceLines(invoice.lines),
    "",
    `Subtotal: $${invoice.subtotal}`,
    `Florida tax (${invoice.taxRate}): $${invoice.tax}`,
    `Brash3D commission (${invoice.commissionRate}): $${invoice.commission}`,
    `*Invoice total: $${invoice.total} USD*`,
    "",
    ...(invoice.balance
      ? [
        `Up-front payment (${invoice.initialPercentage}): $${invoice.initial}`,
        `Balance on delivery (${invoice.balance.percentage}): $${invoice.balance.amount}`,
        "",
        "Confirm your delivery address and make your up-front payment here:",
      ]
      : [
        `Paid in full up front (${invoice.initialPercentage}): $${invoice.initial}`,
        "",
        "Confirm your delivery address and pay here:",
      ]),
    invoice.link,
  ].join("\n"),
}

export function copy(): WhatsAppCopy {
  return messageLocale() === "en" ? EN : ES
}

/** The locale dates are formatted in, matching the copy. */
export function dateLocale(): string {
  return messageLocale() === "en" ? "en-US" : "es-CO"
}
