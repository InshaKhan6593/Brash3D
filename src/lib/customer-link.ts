/**
 * The customer's own URL for an order.
 *
 * Built in one place because it is the customer's only durable way back to
 * their order: it goes in the seller's copied link, in the redirect that
 * exchanges a token for a cookie, and in the Stripe return URLs. A booking can
 * be made days before the session, so the link has to survive a closed tab, a
 * second device and cleared site data -- which means carrying the access token
 * rather than relying on a cookie that lives in one browser profile.
 *
 * `CUSTOMER_ACCESS_PARAM` is deliberately short: the customer sees this URL,
 * and often reads it aloud over a WhatsApp call.
 */
export const CUSTOMER_ACCESS_PARAM = "token"

/**
 * Query string for a customer link, token first so it stays readable.
 *
 * Every caller goes through this rather than appending `&key=value`, because a
 * caller that appends to a link with no token produces `/session/<id>&payment=x`
 * -- a path with an ampersand in it and no query at all. The final-payment
 * checkout has no customer token, so that case is real.
 */
function customerSessionQuery(token?: string | null, extra?: Record<string, string>): string {
  const params = new URLSearchParams()
  if (token) params.set(CUSTOMER_ACCESS_PARAM, token)
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value)
  const query = params.toString()
  return query ? `?${query}` : ""
}

/** Path only, so the caller resolves it against whichever origin it is serving. */
export function customerSessionPath(
  sessionId: string,
  token?: string | null,
  extra?: Record<string, string>
): string {
  return `/session/${encodeURIComponent(sessionId)}${customerSessionQuery(token, extra)}`
}

/** Absolute link, for the seller to copy and for Stripe to redirect back to. */
export function customerSessionUrl(
  origin: string,
  sessionId: string,
  token?: string | null,
  extra?: Record<string, string>
): string {
  return new URL(customerSessionPath(sessionId, token, extra), origin).toString()
}
