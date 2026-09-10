import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

const scrypt = promisify(scryptCallback)

/**
 * Defined once and imported by both the application (`src/lib/auth.ts`) and the
 * account-creation script (`scripts/create-staff.mjs`). If these two ever held
 * separate copies and drifted apart, every staff login would fail with no
 * obvious cause, so the module is plain ESM that TypeScript and node can share.
 */
export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
export const KEY_LENGTH = 64
const SALT_BYTES = 16

/**
 * @param {string} password
 * @param {string} salt
 * @returns {Promise<Buffer>}
 */
export async function derivePassword(password, salt) {
  return /** @type {Promise<Buffer>} */ (scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS))
}

/**
 * @param {string} password
 * @returns {Promise<{ hash: string, salt: string }>}
 */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES).toString("base64url")
  const derived = await derivePassword(password, salt)
  return { hash: derived.toString("base64url"), salt }
}

/**
 * Constant-time comparison, so a wrong password cannot be narrowed down by
 * timing the response.
 * @param {string} password
 * @param {string} salt
 * @param {string} expected
 * @returns {Promise<boolean>}
 */
export async function matchesPassword(password, salt, expected) {
  const actual = await derivePassword(password, salt)
  const expectedBuffer = Buffer.from(expected, "base64url")
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer)
}
