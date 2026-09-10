import { loadEnvConfig } from "@next/env"

// The store modules read DATABASE_URL at import time, so the env has to be
// loaded the same way `next dev` and the migration runner load it.
loadEnvConfig(process.cwd())
