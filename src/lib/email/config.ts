import "server-only"

/**
 * Email settings, read per call so a value added to the environment takes
 * effect on the next request.
 *
 * Optional, like WhatsApp: with `RESEND_API_KEY` unset nothing is sent and the
 * booking flow is exactly as before. An email is a second copy of the order
 * link and the appointment, never the only one.
 */

function read(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export function resendApiKey(): string | undefined {
  return read("RESEND_API_KEY")
}

/**
 * The sender, as `Name <address>`. The address must be on a domain verified in
 * Resend. `onboarding@resend.dev` works without one, but Resend then delivers
 * only to the address that owns the Resend account -- enough to test with,
 * never enough for customers.
 */
export function emailFrom(): string {
  return read("EMAIL_FROM") ?? "Mi Global Shopper <onboarding@resend.dev>"
}

/** Where a customer's reply lands. Unset, replies go to the sender. */
export function emailReplyTo(): string | undefined {
  return read("EMAIL_REPLY_TO")
}

/**
 * Where the staff copy of each booking goes. Unset, it goes to the seller the
 * booking belongs to, at the email on their `vendedores` row.
 */
export function staffEmailOverride(): string | undefined {
  return read("EMAIL_STAFF_TO")
}

export function canSendEmail(): boolean {
  return Boolean(resendApiKey())
}

/** The bare address out of `Name <address>`, for the calendar organizer. */
export function addressOf(mailbox: string): string {
  return mailbox.match(/<([^>]+)>/)?.[1] ?? mailbox
}
