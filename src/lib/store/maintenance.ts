import "server-only"

import { query } from "@/lib/db"
import { logger } from "@/lib/logger"
import { pruneUnscheduledSlots, releaseExpiredBookingHolds } from "@/lib/store/sessionStore"

/**
 * Periodic housekeeping, specification section 14.
 *
 * Expired booking holds are already released opportunistically whenever slots
 * are read or a booking is attempted, which is self-healing but leaves a slot
 * locked until somebody happens to look at it. A customer browsing the calendar
 * in the meantime sees an hour that nobody actually holds. Running the same
 * release on a timer closes that window.
 *
 * The three prunes exist because nothing else deletes from these tables: they
 * only ever grow.
 */

/**
 * Stripe retries a failed webhook for up to three days, and this table is the
 * idempotency ledger that stops a retry being processed twice. Deleting an
 * event still inside the retry window would reopen exactly the double-charge
 * this ledger prevents, so the retention is an order of magnitude longer than
 * the window it protects.
 */
const WEBHOOK_EVENT_RETENTION_DAYS = 30

/** Access tokens are dead once expired; the grace period is for support lookups. */
const ACCESS_TOKEN_RETENTION_DAYS = 7

/** A rate-limit row is meaningless once its window has closed. */
const RATE_LIMIT_RETENTION_HOURS = 24

export type MaintenanceResult = {
  holdsReleased: number
  slotsPruned: number
  webhookEventsPruned: number
  accessTokensPruned: number
  rateLimitsPruned: number
}

/**
 * Safe to run concurrently with live traffic and with itself: every statement
 * is a single self-contained write, so two overlapping runs race only to delete
 * the same already-dead rows.
 */
export async function runMaintenance(): Promise<MaintenanceResult> {
  const holdsReleased = await releaseExpiredBookingHolds()
  // Backstop for slots left behind by a schedule change; the schedule route
  // already prunes on save, so this normally removes nothing.
  const slotsPruned = await pruneUnscheduledSlots()

  const webhookEvents = await query(`
    DELETE FROM stripe_webhook_events
    WHERE processed_at < now() - ($1 || ' days')::interval
  `, [WEBHOOK_EVENT_RETENTION_DAYS])

  const accessTokens = await query(`
    DELETE FROM customer_session_access
    WHERE expires_at < now() - ($1 || ' days')::interval
  `, [ACCESS_TOKEN_RETENTION_DAYS])

  const rateLimits = await query(`
    DELETE FROM request_rate_limits
    WHERE window_started_at < now() - ($1 || ' hours')::interval
  `, [RATE_LIMIT_RETENTION_HOURS])

  const result: MaintenanceResult = {
    holdsReleased,
    slotsPruned,
    webhookEventsPruned: webhookEvents.rowCount ?? 0,
    accessTokensPruned: accessTokens.rowCount ?? 0,
    rateLimitsPruned: rateLimits.rowCount ?? 0,
  }

  // Only worth a log line when it actually did something, so a quiet database
  // does not emit an entry every few minutes forever.
  if (Object.values(result).some((count) => count > 0)) {
    logger.info("Maintenance run completed", result)
  }

  return result
}
