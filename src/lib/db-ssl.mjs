/**
 * TLS settings for the PostgreSQL connection, defined once and imported by both
 * the application pool (`src/lib/db.ts`) and the migration runner
 * (`scripts/migrate.mjs`), the same way `password.mjs` is shared with
 * `scripts/create-staff.mjs`. If the two held separate copies, the app and its
 * migrations could disagree about TLS and only one of them would connect.
 *
 * `pg` does not negotiate TLS on its own: without an explicit `ssl` option it
 * connects in the clear, and every managed provider (Supabase, Neon, Railway)
 * refuses that. Local development against the Docker database has no
 * certificate at all, so TLS is decided by host rather than hard-coded.
 */

import { readFileSync } from "node:fs"

/** Hosts that are always reached over a loopback interface, never over TLS. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

/**
 * @param {string} connectionString
 * @returns {string} the host portion, or "" when the string cannot be parsed
 */
function hostOf(connectionString) {
  try {
    return new URL(connectionString).hostname
  } catch {
    return ""
  }
}

/**
 * `DATABASE_SSL` overrides the host check:
 *   require   - verify the server certificate against the system CA store
 *   no-verify - encrypt but skip verification, for a provider whose CA is not
 *               in the system store. Use only after `require` has been tried.
 *   disable   - no TLS at all
 *
 * @param {string} [connectionString]
 * @returns {false | { rejectUnauthorized: boolean, ca?: string }}
 */
export function sslConfig(connectionString = process.env.DATABASE_URL || "") {
  const override = (process.env.DATABASE_SSL || "").trim().toLowerCase()

  if (override === "disable") return false
  if (override === "no-verify") return { rejectUnauthorized: false }
  if (override === "require") return caConfig()

  // No override: local databases run without TLS, everything else requires it.
  const host = hostOf(connectionString)
  if (!host || LOCAL_HOSTS.has(host)) return false

  return caConfig()
}

/**
 * Verifies against the system CA store unless a provider CA is supplied.
 *
 * Supabase signs its database certificates with its own private root, which no
 * system trust store carries, so verifying against that store alone fails with
 * SELF_SIGNED_CERT_IN_CHAIN. Pinning their root is the fix; disabling
 * verification would drop authentication of the server entirely and leave only
 * encryption, on the connection carrying payment records.
 *
 * `DATABASE_SSL_CA_FILE` names a PEM file (a CA certificate is public, so it
 * belongs in the repository rather than in a secret), and `DATABASE_SSL_CA`
 * carries PEM contents directly for platforms that expose only env values.
 *
 * @returns {{ rejectUnauthorized: boolean, ca?: string }}
 */
function caConfig() {
  const file = process.env.DATABASE_SSL_CA_FILE
  if (file) {
    try {
      return { rejectUnauthorized: true, ca: readFileSync(file, "utf8") }
    } catch (error) {
      // Failing loudly beats silently falling back to the system store and
      // reporting an expired or wrong path as a certificate error later.
      throw new Error(`DATABASE_SSL_CA_FILE could not be read: ${file}`, { cause: error })
    }
  }

  const ca = process.env.DATABASE_SSL_CA
  return ca ? { rejectUnauthorized: true, ca: normalizePem(ca) } : { rejectUnauthorized: true }
}

/**
 * A PEM is multi-line, and the places that carry `DATABASE_SSL_CA` mostly are
 * not: a `.env` file, a CI secret and a dashboard field all tend to arrive with
 * the line breaks escaped as a literal backslash-n. Node's TLS stack does not
 * parse that — it reports no usable certificate, which then surfaces as the
 * same SELF_SIGNED_CERT_IN_CHAIN a missing CA gives, sending whoever debugs it
 * looking in the wrong place.
 *
 * The check for a BEGIN marker catches the other half of that failure, a paste
 * truncated by a field length limit, while the value is still identifiable.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizePem(value) {
  const pem = value.includes("\\n") ? value.replace(/\\n/g, "\n") : value

  if (!pem.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("DATABASE_SSL_CA does not contain a PEM certificate. Supply the full certs/supabase-root-2021.crt contents, BEGIN and END lines included.")
  }

  return pem
}
