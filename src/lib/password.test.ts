import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { authenticateStaff } from "@/lib/auth"
import { query } from "@/lib/db"
import { hashPassword, matchesPassword, SCRYPT_PARAMS } from "@/lib/password.mjs"

const created: string[] = []

afterEach(async () => {
  if (created.length) {
    await query("DELETE FROM staff_sessions WHERE staff_user_id = ANY($1::uuid[])", [created])
    await query("DELETE FROM staff_users WHERE id = ANY($1::uuid[])", [created])
    created.length = 0
  }
})

describe("password derivation", () => {
  it("accepts the correct password and rejects a wrong one", async () => {
    const { hash, salt } = await hashPassword("Correct-Horse-Battery-42!")
    expect(await matchesPassword("Correct-Horse-Battery-42!", salt, hash)).toBe(true)
    expect(await matchesPassword("Wrong-Horse-Battery-42!", salt, hash)).toBe(false)
  })

  it("salts each hash so identical passwords differ", async () => {
    const first = await hashPassword("Same-Password-42!")
    const second = await hashPassword("Same-Password-42!")
    expect(first.salt).not.toBe(second.salt)
    expect(first.hash).not.toBe(second.hash)
  })

  it("keeps the parameters that existing stored hashes were derived with", () => {
    // Changing any of these invalidates every password already in the database,
    // which would lock out all staff. Change them only with a migration plan.
    expect(SCRYPT_PARAMS).toEqual({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  })

  it("produces a hash that the login path accepts", async () => {
    // The regression guard: `scripts/create-staff.mjs` and `src/lib/auth.ts` used
    // to derive hashes independently. If they ever diverge again, this fails.
    const password = "Create-Staff-Parity-42!"
    const email = `parity-${randomUUID().slice(0, 8)}@example.test`
    const { hash, salt } = await hashPassword(password)

    const inserted = await query<{ id: string }>(`
      INSERT INTO staff_users (name, email, password_hash, password_salt, role)
      VALUES ('Parity Check', $1, $2, $3, 'admin') RETURNING id::text
    `, [email, hash, salt])
    created.push(inserted.rows[0].id)

    const session = await authenticateStaff(email, password, { ip: "127.0.0.1" })
    expect(session).not.toBeNull()
    expect(session?.user.email).toBe(email)

    expect(await authenticateStaff(email, "not-the-password", { ip: "127.0.0.1" })).toBeNull()
  })
})
