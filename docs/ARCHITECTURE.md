# Architecture

## Application Routes

| Route | Purpose |
| --- | --- |
| `/` | Customer booking and appointment selection. |
| `/login` | Staff authentication. |
| `/seller` | Authenticated seller/admin dashboard with bookings, customers, and sessions. |
| `/seller?sessionId=<id>` | Seller live-shopping session panel. |
| `/session/<id>` | Customer live cart, order progress, and payments. |
| `/local-team` | Colombia receiving, final collection, and delivery panel. |
| `/api/slots` | Lists booking availability. |
| `/api/bookings` | Creates and retrieves bookings. |
| `/api/sessions` | Reads and mutates shopping sessions. |
| `/api/shipping` | Seller/admin consolidated-box dispatch and manifests. |
| `/api/local-team` | Colombia box receipt and delivery operations. |
| `/api/payments/checkout` | Creates the 65% and final 35% Stripe Checkouts. |
| `/api/notifications` | Persistent seller payment notifications. |
| `/api/stripe/webhook` | Verifies and processes all Stripe payment events. |
| `/access/session/<id>` | Exchanges a customer magic-link token for a scoped HTTP-only cookie. |

## Booking Flow

1. The customer or seller selects a slot.
2. The booking API validates the customer details and slot ID.
3. A PostgreSQL transaction locks the selected availability row and creates a 15-minute pending-payment hold.
4. Stripe Test Mode Checkout collects the 20 USD booking fee.
5. Only a signature-verified Stripe webhook confirms the reservation.
6. Expired holds are released atomically; a late successful payment is refunded idempotently.
7. The customer opens the session page while the seller manages the cart.

Slots are generated in one-hour intervals from 9:00 AM through 6:00 PM for the client-specified Nike Sawgrass outlet. A duplicate request for an active hold or confirmed slot receives a conflict response.

## Access Control

- Staff authenticate through `/login`; database-backed sessions use random tokens stored only as SHA-256 hashes.
- Staff cookies are HTTP-only, same-site, secure in production, and expire after eight hours.
- Seller/admin pages and APIs verify authentication and role authorization on the server.
- Customer order links use random access tokens stored only as hashes. The access route exchanges the URL token for an HTTP-only cookie and redirects to a clean order URL.
- Login and public booking requests are rate limited, and repeated password failures temporarily lock the staff account.

## Live Session Flow

- Seller actions add, remove, and change product quantities through `/api/sessions`.
- The customer and seller session views poll PostgreSQL-backed APIs for updates every 1.5 seconds.
- Closing a session calculates subtotal, 7 percent tax, and a 15 percent Brash3D commission.
- The customer starts the Stripe 65 percent payment after invoicing; the Colombia team initiates the final 35 percent Stripe link at delivery or records cash/transfer.
- The customer confirms a Colombia delivery address before the 65 percent Checkout opens.
- The seller creates one labelled individual shipment after the 65 percent payment.
- USA operations attaches prepared shipments to a consolidated box with one courier/tracking number.
- Colombia confirms physical receipt from the digital manifest, then collects the final balance and confirms delivery.

## UI

- Shared shadcn/ui primitives are kept in `src/components/ui`.
- The seller shell uses the shadcn sidebar and table primitives.
- `next-themes` controls the global light, dark, and system modes.

## Persistence Boundary

`src/lib/store/sessionStore.ts` and `src/lib/store/shippingStore.ts` are the PostgreSQL repository boundary. `src/lib/db.ts` owns the shared connection pool. Docker provides PostgreSQL locally, while tracked numbered SQL migrations provide a path to a managed PostgreSQL production service.
