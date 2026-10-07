/**
 * Where a staff member lands after signing in.
 *
 * The seller's booking email links straight to that session's live screen
 * (`/seller?sessionId=…`). Signing in used to drop the link and land on the
 * dashboard, so the seller had to go and find the session by hand. The page
 * that bounces to `/login` now passes where it was going as `next`, and this
 * decides whether to honour it.
 *
 * Only the app's own two staff screens are accepted, and only the one the role
 * may open. Anything else -- another site, `//evil.example`, a path with a
 * backslash -- falls back to the role's home, so `next` can never be used to
 * send a freshly signed-in user somewhere hostile.
 */

const HOME = { local_team: "/local-team", seller: "/seller", admin: "/seller" } as const

export type StaffRole = keyof typeof HOME

const ALLOWED: Record<StaffRole, readonly string[]> = {
  admin: ["/seller", "/local-team"],
  seller: ["/seller"],
  local_team: ["/local-team"],
}

export function homeFor(role: string): string {
  return HOME[role as StaffRole] ?? "/seller"
}

export function returnPathFor(role: string, next: unknown): string {
  const home = homeFor(role)
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return home
  let url: URL
  try {
    url = new URL(next, "https://staff.invalid")
  } catch {
    return home
  }
  if (url.origin !== "https://staff.invalid") return home
  const allowed = ALLOWED[role as StaffRole] ?? []
  return allowed.includes(url.pathname) ? `${url.pathname}${url.search}` : home
}

/** The `/login` URL that comes back to `path` (with its query) afterwards. */
export function loginUrlReturningTo(path: string): string {
  return `/login?next=${encodeURIComponent(path)}`
}
