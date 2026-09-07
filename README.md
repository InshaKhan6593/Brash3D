# Brash3D Live Shopping

Brash3D is a Next.js MVP for booking a live outlet-shopping session, managing it from a seller dashboard, and following the cart and payment progress from a customer view.

## What is included

- Customer booking from today through the end of next month.
- One-hour slots from 9:00 AM to 6:00 PM at each configured demo outlet.
- Booked slots stay visible and disabled.
- Seller dashboard with bookings, customers, sessions, tables, row actions, and pagination.
- Seller-created bookings and a live product-entry panel.
- Customer live cart, order timeline, and Stripe-backed 65/35 payment flow.
- USA seller/admin workflow for consolidated-box dispatch, plus a Colombia receiving manifest, final collection, and delivery confirmation.
- Shared shadcn/ui components with neutral light and dark themes.

## Local setup

```bash
npm install
docker compose up -d
cp .env.example .env.local
npm run db:migrate
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env.local` instead of `cp`. Replace the Stripe placeholders in `.env.local` directly. Never commit that file. PostgreSQL binds only to `127.0.0.1:5440`, and all numbered migrations are tracked in `supabase/migrations`.

Open [http://localhost:3000](http://localhost:3000). The seller dashboard is available at [http://localhost:3000/seller](http://localhost:3000/seller).

Create the first staff administrator after migrating the database:

```bash
npm run auth:create-staff -- admin@example.com "Use-A-Strong-Password-42!" admin "Administrator Name"
```

The active Nike Sawgrass seller can be given a scoped account with the same command using `maria@brash3d.com` and the `seller` role. A Colombia operator uses the `local_team` role and an email present in `equipos_locales`.

Staff sign in at [http://localhost:3000/login](http://localhost:3000/login). Customer order links exchange a secure URL token for a scoped HTTP-only cookie and do not require customer passwords.

For Stripe Test Mode, keep `STRIPE_MODE=test`, place rotated test keys in `.env.local`, run `stripe login`, and keep this command running in a second terminal:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the CLI's `whsec_...` signing secret directly into `.env.local` and restart the app. Stripe events reach localhost through this authenticated forwarding connection.

At production launch, explicitly set `STRIPE_MODE=live` and use only matching `sk_live_` credentials. The server rejects a key whose mode does not match this setting.

## Quality checks

```bash
npm run lint
npm run build
npm run test:smoke
```

The smoke test expects the development server to be running on port 3000 and removes the test records it creates.

## Production deployment

- Use a managed PostgreSQL database and run `npm run db:migrate` during deployment.
- Set `STRIPE_MODE=live` with a rotated live secret and production webhook signing secret.
- Register the public HTTPS endpoint `/api/stripe/webhook` in Stripe.
- Create unique staff accounts with strong passwords; do not reuse local credentials.
- Run behind HTTPS so secure authentication cookies are enforced.
- Configure database backups, application logs, and uptime monitoring.
- Add Meta WhatsApp and courier credentials only after the client selects those providers.

## Documentation

- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Testing guide](docs/TESTING.md)

## Remaining external integrations

Bookings, 15-minute holds, sessions, carts, shipment records, consolidated boxes, authentication sessions, secure customer links, and payment logs are persisted in local PostgreSQL. All three Stripe payment stages are wired. WhatsApp delivery and live courier API synchronization still require provider credentials; USA operations enters courier and tracking data when dispatching a consolidated box.
