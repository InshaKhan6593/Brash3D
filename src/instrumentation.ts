/**
 * Starts the periodic maintenance run (`src/lib/store/maintenance.ts`) when the
 * server boots.
 *
 * This covers a long-running host such as Railway, Render or Fly, where one
 * process stays up and an interval is the whole scheduler. It is deliberately
 * a no-op on a serverless host: there, each request runs in an instance that is
 * frozen the moment it returns, so a timer would never fire again. Those
 * deployments call `POST /api/maintenance` from the platform's own cron
 * instead, which runs exactly the same work.
 *
 * Set `MAINTENANCE_INTERVAL_MINUTES=0` to disable the in-process timer when the
 * platform cron is the one driving it.
 */

const DEFAULT_INTERVAL_MINUTES = 5

export async function register() {
  // `register` also runs in the edge runtime, which has no timers worth using
  // and no database access.
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const minutes = Number(process.env.MAINTENANCE_INTERVAL_MINUTES ?? DEFAULT_INTERVAL_MINUTES)
  if (!Number.isFinite(minutes) || minutes <= 0) return

  // The dev server re-runs this on hot reload; without the guard each reload
  // would leave another timer behind.
  const globalScheduler = globalThis as typeof globalThis & { __brash3dMaintenance?: boolean }
  if (globalScheduler.__brash3dMaintenance) return
  globalScheduler.__brash3dMaintenance = true

  const { runMaintenance } = await import("@/lib/store/maintenance")
  const { logger } = await import("@/lib/logger")

  const tick = async () => {
    try {
      await runMaintenance()
    } catch (error) {
      // A failed run must never take the server down with it; the next tick
      // retries, and the failure is visible in the logs.
      logger.error("Scheduled maintenance run failed", { error })
    }
  }

  const timer = setInterval(tick, minutes * 60_000)
  // Do not hold the process open during shutdown purely for this timer.
  timer.unref()

  logger.info("Scheduled maintenance started", { intervalMinutes: minutes })
}
