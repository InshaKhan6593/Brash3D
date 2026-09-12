import "server-only"

/**
 * Whether live cart updates run over Supabase Realtime, and with what.
 *
 * Realtime is optional on purpose. Until every value below is set the app polls
 * exactly as it did before, so the deployment never depends on a key being
 * present: a missing or rotated credential degrades to the slower path instead
 * of taking the customer's order page down mid-session.
 *
 * **None of these carry a `NEXT_PUBLIC_` prefix, and none belong in the client
 * bundle.** The browser does need the project URL and publishable key to open
 * its socket, but it receives them from `GET /api/realtime/token` -- a response
 * it only gets after proving it holds a customer access token for that session.
 * Inlining them at build time instead would publish them to every visitor of
 * every page for no gain, which is what a `NEXT_PUBLIC_` prefix means and what
 * Vercel warns about when it sees one.
 *
 * `server-only` above makes that structural: importing this from a client
 * component is a build error, not a value that silently reads `undefined` in
 * the browser and disables Realtime with no explanation.
 */
export const SUPABASE_URL = process.env.SUPABASE_URL || ""
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || ""

/** The browser can open a socket at all. The token decides what it may read. */
export function isRealtimeConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
}

/**
 * The claim the RLS policies read, naming the one session a token may see.
 *
 * A subscription filter is client-supplied and therefore worthless as a
 * boundary -- anyone holding the publishable key could ask for another
 * customer's session. The scope has to come from something the database can
 * verify, which is why it is a signed claim rather than a query parameter.
 */
export const SESSION_CLAIM = "session_id"

/** Short enough that a leaked token expires before it is worth passing on. */
export const REALTIME_TOKEN_TTL_SECONDS = 60 * 60
