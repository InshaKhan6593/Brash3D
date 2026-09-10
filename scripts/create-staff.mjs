import process from "node:process"
import nextEnv from "@next/env"
import pg from "pg"
import { hashPassword } from "../src/lib/password.mjs"

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())
const [emailInput, password, roleInput = "admin", ...nameParts] = process.argv.slice(2)
const email = emailInput?.trim().toLowerCase()
const role = roleInput.trim().toLowerCase()
const name = nameParts.join(" ").trim() || "Brash3D Administrator"

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("Usage: npm run auth:create-staff -- email password admin 'Full Name'")
}
if (!password || password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
  throw new Error("Password must be at least 12 characters with upper, lower, number, and symbol")
}
if (!["admin", "seller", "local_team"].includes(role)) throw new Error("Invalid role")

const { hash, salt } = await hashPassword(password)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
try {
  let sellerId = null
  let localTeamId = null
  if (role === "seller") {
    const seller = await pool.query(
      "SELECT id::text FROM vendedores WHERE lower(email) = $1 AND activo = true",
      [email]
    )
    if (!seller.rows[0]) throw new Error("Seller staff email must match an active seller record")
    sellerId = seller.rows[0].id
  }
  if (role === "local_team") {
    const team = await pool.query(
      "SELECT id::text FROM equipos_locales WHERE lower(email) = $1",
      [email]
    )
    if (!team.rows[0]) throw new Error("Local-team email must match a configured local team")
    localTeamId = team.rows[0].id
  }
  await pool.query(`
    INSERT INTO staff_users (name, email, password_hash, password_salt, role, seller_id, local_team_id)
    VALUES ($1, $2, $3, $4, $5, $6::uuid, $7::uuid)
    ON CONFLICT ((lower(email))) DO UPDATE SET
      name = EXCLUDED.name,
      password_hash = EXCLUDED.password_hash,
      password_salt = EXCLUDED.password_salt,
      role = EXCLUDED.role,
      seller_id = EXCLUDED.seller_id,
      local_team_id = EXCLUDED.local_team_id,
      active = true,
      failed_attempts = 0,
      locked_until = NULL
  `, [name, email, hash, salt, role, sellerId, localTeamId])
  console.log(`${role} account is ready: ${email}`)
} finally {
  await pool.end()
}
