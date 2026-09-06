# Brash3D Live Shopping

Brash3D is a Next.js MVP for booking a live outlet-shopping session, managing it from a seller dashboard, and following the cart and payment progress from a customer view.

## What is included

- Customer booking from today through the end of next month.
- One-hour slots from 9:00 AM to 6:00 PM at each configured demo outlet.
- Booked slots stay visible and disabled.
- Seller dashboard with bookings, customers, sessions, tables, row actions, and pagination.
- Seller-created bookings and a live product-entry panel.
- Customer live cart, order timeline, and simulated 65/35 payment flow.
- Shared shadcn/ui components with neutral light and dark themes.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The seller dashboard is available at [http://localhost:3000/seller](http://localhost:3000/seller).

## Quality checks

```bash
npm run lint
npm run build
```

## Documentation

- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Testing guide](docs/TESTING.md)

## Current limitation

This is a demo MVP. Bookings, sessions, carts, and payments are held in memory, so they reset when the server restarts. Supabase persistence, Stripe payment processing, WhatsApp delivery, and courier integrations remain production work.
