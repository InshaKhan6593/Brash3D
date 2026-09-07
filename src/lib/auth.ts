import "server-only"

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import type { QueryResultRow } from "pg"
import { query, transaction } from "@/lib/db"

export type StaffRole = "admin" | "seller" | "local_team"

export interface StaffUser {
  id: string
  name: string
  email: string
  role: StaffRole
  sellerId?: string
  localTeamId?: string
}

interface StaffRow extends QueryResultRow {
  id: string
  name: string
  email: string
  password_hash: string
  password_salt: string
  role: StaffRole
  seller_id: string | null
  local_team_id: string | null
  active: boolean
  locked_until: Date | null
}

export const STAFF_COOKIE = "brash3d_staff_session"
export const CUSTOMER_COOKIE = "brash3d_customer_access"
const SESSION_HOURS = 8
const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

async function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      64,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => error ? reject(error) : resolve(derivedKey)
    )
  })
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("base64url")
  const derived = await derivePassword(password, salt)
  return { hash: derived.toString("base64url"), salt }
}

async function matchesPassword(password: string, salt: string, expected: string): Promise<boolean> {
  const actual = await derivePassword(password, salt)
  const expectedBuffer = Buffer.from(expected, "base64url")
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer)
}

function mapStaff(row: Pick<StaffRow, "id" | "name" | "email" | "role" | "seller_id" | "local_team_id">): StaffUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    sellerId: row.seller_id || undefined,
    localTeamId: row.local_team_id || undefined,
  }
}

export async function authenticateStaff(
  email: string,
  password: string,
  metadata: { ip?: string; userAgent?: string }
): Promise<{ user: StaffUser; token: string; expiresAt: Date } | null> {
  const normalizedEmail = email.trim().toLowerCase()
  const result = await query<StaffRow>(`
    SELECT id::text, name, email, password_hash, password_salt, role,
      seller_id::text, local_team_id::text, active, locked_until
    FROM staff_users WHERE lower(email) = $1
  `, [normalizedEmail])
  const row = result.rows[0]

  // Always perform password derivation so unknown emails do not return noticeably faster.
  const dummySalt = "YjNhc2gzZC1kdW1teS1zYWx0"
  const dummyHash = "zQH6vovYWDQMe5BVSRt54TlANgKvKIpGwEKY9KDsVcFgJJGtvSu8NC87FtLKY2QWwlh4AFvKRPErtILNe4G99Q"
  const valid = row
    ? await matchesPassword(password, row.password_salt, row.password_hash)
    : await matchesPassword(password, dummySalt, dummyHash)

  if (!row || !row.active || (row.locked_until && row.locked_until > new Date()) || !valid) {
    if (row?.active && (!row.locked_until || row.locked_until <= new Date())) {
      await query(`
        UPDATE staff_users SET
          failed_attempts = failed_attempts + 1,
          locked_until = CASE
            WHEN failed_attempts + 1 >= $2 THEN now() + ($3 || ' minutes')::interval
            ELSE locked_until
          END
        WHERE id = $1::uuid
      `, [row.id, MAX_FAILED_ATTEMPTS, LOCK_MINUTES])
    }
    return null
  }

  return transaction(async (client) => {
    const token = randomBytes(32).toString("base64url")
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000)
    await client.query(`
      UPDATE staff_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now()
      WHERE id = $1::uuid
    `, [row.id])
    await client.query("DELETE FROM staff_sessions WHERE expires_at <= now()")
    await client.query(`
      INSERT INTO staff_sessions (staff_user_id, token_hash, expires_at, ip_address, user_agent)
      VALUES ($1::uuid, $2, $3, NULLIF($4, '')::inet, $5)
    `, [row.id, tokenHash(token), expiresAt, metadata.ip || "", metadata.userAgent || null])
    return { user: mapStaff(row), token, expiresAt }
  })
}

export async function setStaffCookie(token: string, expiresAt: Date): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(STAFF_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
    priority: "high",
  })
}

export async function getStaffSession(): Promise<StaffUser | null> {
  const token = (await cookies()).get(STAFF_COOKIE)?.value
  if (!token) return null
  const result = await query<StaffRow>(`
    SELECT u.id::text, u.name, u.email, u.password_hash, u.password_salt, u.role,
      u.seller_id::text, u.local_team_id::text, u.active, u.locked_until
    FROM staff_sessions s
    JOIN staff_users u ON u.id = s.staff_user_id
    WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = true
  `, [tokenHash(token)])
  return result.rows[0] ? mapStaff(result.rows[0]) : null
}

export async function revokeCurrentStaffSession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(STAFF_COOKIE)?.value
  if (token) await query("DELETE FROM staff_sessions WHERE token_hash = $1", [tokenHash(token)])
  cookieStore.delete(STAFF_COOKIE)
}

export async function requireStaff(roles: StaffRole[] = ["admin", "seller", "local_team"]): Promise<StaffUser | null> {
  const user = await getStaffSession()
  return user && roles.includes(user.role) ? user : null
}

export function requestHasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return false
  try {
    const originUrl = new URL(origin)
    const requestUrl = new URL(request.url)
    return originUrl.host === requestUrl.host && originUrl.protocol === requestUrl.protocol
  } catch {
    return false
  }
}

export async function allowRequest(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  return transaction(async (client) => {
    const result = await client.query<{ request_count: number; allowed: boolean }>(`
      INSERT INTO request_rate_limits (key, request_count, window_started_at)
      VALUES ($1, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        request_count = CASE
          WHEN request_rate_limits.window_started_at <= now() - ($3 || ' seconds')::interval THEN 1
          ELSE request_rate_limits.request_count + 1
        END,
        window_started_at = CASE
          WHEN request_rate_limits.window_started_at <= now() - ($3 || ' seconds')::interval THEN now()
          ELSE request_rate_limits.window_started_at
        END
      RETURNING request_count, request_count <= $2 AS allowed
    `, [key, limit, windowSeconds])
    await client.query(`
      DELETE FROM request_rate_limits
      WHERE window_started_at < now() - interval '2 days'
    `)
    return result.rows[0].allowed
  })
}

export function generateCustomerToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url")
  return {
    token,
    hash: tokenHash(token),
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  }
}

export async function verifyCustomerAccess(sessionId: string, token: string | null): Promise<boolean> {
  const candidate = token || (await cookies()).get(CUSTOMER_COOKIE)?.value || null
  if (!candidate) return false
  const result = await query(`
    SELECT 1 FROM customer_session_access
    WHERE session_id::text = $1 AND token_hash = $2
      AND revoked_at IS NULL AND expires_at > now()
  `, [sessionId, tokenHash(candidate)])
  return Boolean(result.rowCount)
}
