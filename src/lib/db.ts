import "server-only"

import { Pool, type PoolClient, type QueryResultRow } from "pg"
import { sslConfig } from "@/lib/db-ssl.mjs"

const globalDatabase = globalThis as typeof globalThis & {
  __brash3dPool?: Pool
}

function connectionString(): string {
  const value = process.env.DATABASE_URL

  if (!value) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL is required in production")
    }
    return "postgresql://postgres:postgres@localhost:5440/brash3d"
  }

  return value
}

export const db =
  globalDatabase.__brash3dPool ??
  new Pool({
    connectionString: connectionString(),
    ssl: sslConfig(connectionString()),
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })

if (process.env.NODE_ENV !== "production") {
  globalDatabase.__brash3dPool = db
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return db.query<T>(text, values)
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query("BEGIN")
    const result = await work(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
