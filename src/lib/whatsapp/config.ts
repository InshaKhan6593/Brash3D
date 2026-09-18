import "server-only"

/**
 * WhatsApp Cloud API settings, read once per call rather than at module load so
 * a value added to the environment takes effect on the next request.
 *
 * Every one of these is optional. With them unset the integration is inert: no
 * message is sent, the webhook refuses everything, and the web cart carries the
 * session exactly as it does today. Specification section 7.1 is explicit that
 * the cart is the authoritative total and the WhatsApp echo is parallel to it,
 * so a missing credential has to degrade rather than break.
 */

const DEFAULT_API_VERSION = "v23.0"

function read(name: string): string | undefined {
  const value = process.env[name]
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

/** The Graph API host and version every send call is built on. */
export function apiVersion(): string {
  return read("WHATSAPP_API_VERSION") ?? DEFAULT_API_VERSION
}

export function phoneNumberId(): string | undefined {
  return read("WHATSAPP_PHONE_NUMBER_ID")
}

export function accessToken(): string | undefined {
  return read("WHATSAPP_CLOUD_API_TOKEN")
}

/**
 * The business number in international format, digits only.
 *
 * Tolerant of how a number is usually copied out of Meta's dashboard -- with a
 * leading `+`, spaces, brackets and dashes -- because a `wa.me` link built from
 * any of those silently opens nothing, and the failure appears mid-call as "the
 * customer tapped it and nothing happened".
 */
export function businessNumber(): string | undefined {
  const raw = read("WHATSAPP_BUSINESS_NUMBER")
  if (!raw) return undefined
  const digits = raw.replace(/\D/g, "")
  return digits === "" ? undefined : digits
}

/** Sending needs only these three; the webhook is independent of them. */
export function canSend(): boolean {
  return Boolean(phoneNumberId() && accessToken())
}

/**
 * The link the customer taps to open the 24-hour customer service window.
 *
 * This is the whole mechanism, and it exists because the specification's
 * assumption in 7.1 does not hold: a WhatsApp *video* call does not open the
 * window. Meta's calling exception covers voice calls on the Business Calling
 * API, which is a different surface from the seller's own handset. So the
 * customer opens the window themselves, from a page we control, and everything
 * the seller sends for the next 24 hours is ordinary free text.
 *
 * The prefilled text matters: it has to be something a customer will send
 * without editing, and it has to read as theirs rather than as a system string.
 */
export function customerChatLink(prefilledText: string): string | undefined {
  const number = businessNumber()
  if (!number) return undefined
  return `https://wa.me/${number}?text=${encodeURIComponent(prefilledText)}`
}

/**
 * Approved template names, which differ per WhatsApp Business Account.
 *
 * A template created on a developer's test account cannot be reused on the
 * client's, so the names are configuration rather than constants: the same
 * build runs against a test WABA today and the client's later, with nothing to
 * recompile. Unset, the template path is skipped and only free text is
 * attempted -- which is correct before any template has been approved.
 */
export function bookingTemplate(): string | undefined {
  return read("WHATSAPP_TEMPLATE_BOOKING")
}

export function productTemplate(): string | undefined {
  return read("WHATSAPP_TEMPLATE_PRODUCT")
}

/**
 * The language a template was approved in. Meta matches on this exactly: a
 * template approved as `es` cannot be sent as `es_ES`, and the send fails with
 * a template-not-found error that names neither.
 */
export function templateLanguage(): string {
  return read("WHATSAPP_TEMPLATE_LANGUAGE") ?? "es"
}

/**
 * The language the customer's WhatsApp messages are written in.
 *
 * Spanish by default, which is the shipping copy for Colombian buyers. `en`
 * exists so the team building this can read what they are sending during
 * testing, and is not meant for production.
 */
export function messageLocale(): "es" | "en" {
  return read("WHATSAPP_MESSAGE_LOCALE") === "en" ? "en" : "es"
}

/**
 * The origin customer links are built on, when the request cannot supply one.
 *
 * A Stripe webhook arriving at a tunnel, or at localhost during testing, yields
 * an origin that is right for the request and useless in a message: WhatsApp
 * does not linkify `localhost`, so the customer receives plain text where a
 * tappable link should be. Setting this pins every link to the real site.
 */
export function appUrl(): string | undefined {
  const raw = read("APP_URL")
  if (!raw) return undefined
  return raw.replace(/\/+$/, "")
}

export function verifyToken(): string | undefined {
  return read("WHATSAPP_VERIFY_TOKEN")
}

export function appSecret(): string | undefined {
  return read("WHATSAPP_APP_SECRET")
}
