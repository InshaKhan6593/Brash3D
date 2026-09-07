# TestSprite local testing setup

This project is prepared for TestSprite CLI/MCP testing against the local
Next.js server. The intended target is `http://localhost:3000`; do not create a
manual public deployment or tunnel. TestSprite's CLI opens a temporary,
authenticated per-run tunnel when `--local` is used.

## What TestSprite does

TestSprite's current CLI can connect an IDE assistant, create frontend/backend
plans, execute browser/API tests, and produce detailed run results. The
frontend executor runs in the cloud, but `testsprite test run --local <port>`
opens a temporary authenticated tunnel to the local process for that run. No
manual public URL or deployment is required.

The TestSprite API key belongs in the CLI profile or IDE's private MCP
configuration. Never put it in `.env.local`, this repository, or a prompt.

## Local prerequisites

From `brash3d-app`:

```powershell
docker start brash3d-postgres
npm run db:migrate
npm run dev
```

In a second terminal, verify the exact target TestSprite will use:

```powershell
npm run test:testsprite:preflight
```

The app must report `http://localhost:3000/api/health` as healthy and the
database must be connected. If another Next.js process already owns port 3000,
reuse that process or stop it before starting a clean one; do not silently
configure TestSprite for a different port.

## TestSprite CLI setup

TestSprite's current CLI uses Node.js 22+ and the npm package
`@testsprite/testsprite-cli`. Create an API key in the TestSprite dashboard,
then run this once in PowerShell:

```powershell
npm install --global @testsprite/testsprite-cli@latest
testsprite setup --agent codex --dir "C:\Users\Insha Khan\brash3d\brash3d-app"
testsprite doctor
```

`testsprite doctor` should report valid credentials and local-tunnel support.
The API key is stored by the CLI profile, not in this repository.

For IDEs that use MCP directly, the equivalent configuration is:

Cursor project configuration (`.cursor/mcp.json`, kept local and uncommitted):

```json
{
  "mcpServers": {
    "TestSprite": {
      "command": "npx",
      "args": ["@testsprite/testsprite-mcp@latest"],
      "env": {
        "API_KEY": "paste-your-key-locally"
      }
    }
  }
}
```

VS Code MCP configuration uses the same command and environment, under the
`mcp.servers` configuration key. Follow the IDE's MCP setup UI rather than
committing either configuration file.

## First TestSprite run

Use this prompt in the IDE after the TestSprite guidance/MCP integration is
connected, or use the CLI test plans committed under `testsprite_tests/plans`:

```text
Help me test this project with TestSprite. Use the local app at http://localhost:3000.
Test the complete Brash3D booking, seller live-shopping, customer order, USA
shipping, and Colombia local-team delivery flows. Use test-mode Stripe only.
Do not use production credentials, manually created public tunnels, or real
payments.
```

In TestSprite's configuration portal select:

- Type: Frontend for the first pass. Run a separate Backend pass afterward.
- Scope: Codebase for the first complete baseline.
- Frontend URL: the local target supplied by the CLI run (`--local 3000` or
  `--local 3001`). The project metadata URL cannot be localhost; it is not used
  for these local runs.
- Direct path: `/` for the first pass; add `/seller`, `/session/<id>`, and
  `/local-team` only when the relevant authenticated setup is ready.
- PRD: upload `Brash3D_Design_and_Technical_Spec.md`.
- Credentials: use local-only staff accounts, never production credentials.

The app has three staff roles: `admin`, `seller`, and `local_team`. Create or
reset dedicated local accounts with the existing command, for example:

```powershell
$adminPassword = Read-Host "Enter a strong local admin password"
$sellerPassword = Read-Host "Enter a strong local seller password"
$localTeamPassword = Read-Host "Enter a strong local-team password"
npm run auth:create-staff -- testsprite-admin@local.test $adminPassword admin "TestSprite Local Admin"
npm run auth:create-staff -- maria@brash3d.com $sellerPassword seller "TestSprite Seller"
npm run auth:create-staff -- colombia@brash3d.com $localTeamPassword local_team "TestSprite Colombia"
```

Use the resulting credentials only in TestSprite's configuration portal. The
customer booking flow does not require a customer password; customer access is
through a scoped order-link cookie.

## Recommended test order

1. Public booking and slot conflict behavior.
2. Staff login, role isolation, and seller dashboard navigation.
3. Seller session start, product entry, quantity changes, and session close.
4. Customer cart, invoice totals, delivery address, and order timeline.
5. USA shipment creation, consolidated box dispatch, and manifest.
6. Colombia receipt, Stripe/cash/transfer final collection, and delivery.
7. Negative/security checks: unauthenticated APIs, cross-customer access,
   local-team access to USA operations, and invalid payment/webhook states.

Stripe checkout should remain in Test Mode. TestSprite should not be expected
to validate a real Stripe charge; the repository's smoke test already covers
the payment lifecycle with database fixtures, while Stripe webhook behavior
should be tested separately with Stripe CLI forwarding when needed.

## Existing baseline gates

Run these before and after a TestSprite session:

```powershell
npm run lint
npm run build
npm run test:smoke
```

To run an existing local TestSprite case directly:

```powershell
testsprite test run <test-id> --local 3001 --wait --timeout 600 --output json
```

Use port 3000 for the development server or port 3001 for the production build
started with `npm run start -- -p 3001`. The production build is preferred for
TestSprite because it avoids dev-server HMR/origin noise.

TestSprite-generated reports can remain local under `testsprite_tests/`. Its
temporary files are ignored by Git because they may contain credentials,
session data, screenshots, or environment-specific output.
