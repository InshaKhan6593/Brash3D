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
}

export function copy(): WhatsAppCopy {
  return messageLocale() === "en" ? EN : ES
}

/** The locale dates are formatted in, matching the copy. */
export function dateLocale(): string {
  return messageLocale() === "en" ? "en-US" : "es-CO"
}
