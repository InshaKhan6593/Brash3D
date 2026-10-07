import "server-only"

import { logger } from "@/lib/logger"
import { canSendEmail, emailFrom, emailReplyTo, resendApiKey } from "@/lib/email/config"

export type EmailOutcome =
  | { status: "sent"; id: string }
  | { status: "disabled" }
  | { status: "failed"; detail: string }

export interface EmailAttachment {
  filename: string
  /** Text, or bytes already in base64 when `encoding` says so. */
  content: string
  encoding?: "utf8" | "base64"
  contentType: string
  /** Set for an image shown in the body as `cid:<contentId>`. */
  contentId?: string
}

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  attachments?: EmailAttachment[]
}

/**
 * Sends one email through Resend's HTTP API.
 *
 * Returns an outcome rather than throwing, for the same reason the WhatsApp
 * sends do: the booking is confirmed and paid before this runs, and a mail
 * outage must never undo that or make Stripe retry a webhook already applied.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailOutcome> {
  if (!canSendEmail()) return { status: "disabled" }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFrom(),
        to: [message.to],
        reply_to: emailReplyTo(),
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.encoding === "base64"
            ? attachment.content
            : Buffer.from(attachment.content, "utf8").toString("base64"),
          content_type: attachment.contentType,
          content_id: attachment.contentId,
        })),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string }
    if (!response.ok || !body.id) {
      const detail = body.message || body.name || `HTTP ${response.status}`
      logger.warn("Email send failed", { status: response.status, detail })
      return { status: "failed", detail }
    }
    return { status: "sent", id: body.id }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error"
    logger.warn("Email send failed", { detail })
    return { status: "failed", detail }
  }
}
