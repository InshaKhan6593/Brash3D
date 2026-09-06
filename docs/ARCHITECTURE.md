# Architecture

## Application Routes

| Route | Purpose |
| --- | --- |
| `/` | Customer booking and appointment selection. |
| `/seller` | Seller dashboard with bookings, customers, and sessions. |
| `/seller?sessionId=<id>` | Seller live-shopping session panel. |
| `/session/<id>` | Customer live cart, order progress, and payments. |
| `/api/slots` | Lists booking availability. |
| `/api/bookings` | Creates and retrieves bookings. |
| `/api/sessions` | Reads and mutates shopping sessions. |

## Booking Flow

1. The customer or seller selects a slot.
2. The booking API validates the customer details and slot ID.
3. The in-memory store checks availability and marks that exact slot unavailable.
4. A reservation and seller-assigned shopping session are created.
5. The customer opens the session page while the seller manages the cart.

Slots are generated in one-hour intervals from 9:00 AM through 6:00 PM. Every configured outlet has one slot for each hour. A duplicate request for an unavailable slot receives a conflict response.

## Live Session Flow

- Seller actions add, remove, and change product quantities through `/api/sessions`.
- The customer and seller session views poll for updates every 1.5 seconds.
- Closing a session calculates subtotal, 7 percent tax, and a 15 percent Brash3D commission.
- The customer page exposes a simulated 65 percent initial payment and 35 percent delivery payment.

## UI

- Shared shadcn/ui primitives are kept in `src/components/ui`.
- The seller shell uses the shadcn sidebar and table primitives.
- `next-themes` controls the global light, dark, and system modes.

## Persistence Boundary

`src/lib/store/sessionStore.ts` is the demo persistence boundary. Replacing that store with Supabase repositories is the main path to production persistence.
