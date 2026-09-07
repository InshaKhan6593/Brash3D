import process from "node:process"

const baseUrl = process.env.TESTSPRITE_BASE_URL || "http://localhost:3000"
const nodeMajor = Number(process.versions.node.split(".")[0])
const localPort = new URL(baseUrl).port || (new URL(baseUrl).protocol === "https:" ? "443" : "80")

if (nodeMajor < 22) {
  console.error(`TestSprite requires Node.js 22+. Current version: ${process.version}`)
  process.exit(1)
}

let response
try {
  response = await fetch(`${baseUrl}/api/health`)
} catch (error) {
  console.error(`Cannot reach ${baseUrl}. Start the local app with: npm run dev`)
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

let body
try {
  body = await response.json()
} catch {
  body = null
}

if (!response.ok || body?.status !== "ok" || body?.database !== "connected") {
  console.error(`Local health check failed: HTTP ${response.status}`)
  console.error(body ?? "No JSON response")
  process.exit(1)
}

console.log("TestSprite local preflight passed")
console.log(`- Node: ${process.version}`)
console.log(`- Local app: ${baseUrl}`)
console.log("- Database: connected")
console.log(`- TestSprite configuration: frontend / codebase / local port ${localPort}`)
