/**
 * The seller dashboard's tabs, and the URL they live in.
 *
 * Deliberately its own module rather than part of `seller-panel.tsx`: that file
 * is `"use client"`, and `src/app/seller/page.tsx` is a server component that
 * has to parse `?tab=` before it renders the panel. Calling into a client
 * module from the server throws at request time -- "Attempted to call
 * dashboardTabFrom() from the server but dashboardTabFrom is on the client" --
 * and the build does not catch it, because the boundary is only enforced when
 * the route actually runs.
 *
 * The tab is URL state rather than component state so the sidebar can link to
 * it. As component state it could not: inside a live session panel the sidebar
 * had no handler to call, so every item fell back to a link to `/seller` and
 * clicking "Shipping" landed on Overview.
 */
export type DashboardTab = "overview" | "bookings" | "customers" | "sessions" | "shipping" | "schedule"

export const DASHBOARD_TABS: readonly DashboardTab[] = [
  "overview", "bookings", "customers", "sessions", "shipping", "schedule",
]

/** Anything unrecognised is Overview: a hand-typed tab must not break the page. */
export function dashboardTabFrom(value: string | string[] | undefined): DashboardTab {
  return typeof value === "string" && (DASHBOARD_TABS as readonly string[]).includes(value)
    ? value as DashboardTab
    : "overview"
}

/** Overview is the bare path, so the dashboard keeps one canonical URL. */
export function dashboardTabHref(tab: DashboardTab): string {
  return tab === "overview" ? "/seller" : `/seller?tab=${tab}`
}
