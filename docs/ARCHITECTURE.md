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
| `/api/customer-history` | Secure customer purchase history and referral-reward summary. |
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

## Language

Customer-facing screens (`/`, `/session/<id>`) and the Colombia local-team panel
are in Spanish, matching the client's approved designs and the Colombian buyer
audience. The USA seller/admin dashboard stays in English. `PurchaseHistoryTable`
is shared by both and takes a `locale` prop rather than hard-coding its copy.

## Access Control

Every query runs server-side behind the route handlers below, which authorize
each request before touching PostgreSQL. The application connects as the table
owner and never exposes a database key to any client.

Row Level Security is nevertheless enabled on every public table, with no
policies (migration 015). That is not what section 8 of the specification asked
for — its policies protect an anon key held by the browser, which this
application does not use — but the database is hosted on Supabase, and Supabase
serves PostgREST over the `public` schema to anyone holding the publishable key
whether or not the app touches supabase-js. RLS with no policies denies every
role except the owner, which closes that endpoint. Authorization in the route
handlers remains the real control; this is the floor beneath it.

A migration that adds a table must enable RLS on it explicitly. `npm run
db:check` fails if one does not.


- Staff authenticate through `/login`; database-backed sessions use random tokens stored only as SHA-256 hashes.
- Staff cookies are HTTP-only, same-site, secure in production, and expire after eight hours.
- Seller/admin pages and APIs verify authentication and role authorization on the server.
- Customer order links use random access tokens stored only as hashes. The access route exchanges the URL token for an HTTP-only cookie and redirects to a clean order URL.
- Login and public booking requests are rate limited, and repeated password failures temporarily lock the staff account.

## Live Session Flow

- Seller actions add, remove, and change product quantities through `/api/sessions`.
- The customer and seller session views poll PostgreSQL-backed APIs for updates every 1.5 seconds.
- Closing a session calculates subtotal, tax, and the Brash3D commission using the rates stored on that session. `TAX_RATE_FL` and `FEE_RATE` set the rates for newly created sessions; an existing session keeps the rates it was priced with, so a rate change never reprices a quoted invoice.
- A referrer earns at most `REFERRAL_REWARD_MONTHLY_CAP` complimentary bookings per calendar month.
- Each customer receives a referral code. A referrer earns one 20 USD booking reward only after the referred customer's first 65 percent payment; the next eligible booking automatically consumes that reward.
- Customer history exposes completed purchases to the customer through their secure session access and to the assigned seller through staff authorization.
- The seller chooses the up-front percentage when closing the session. `sesiones_compra.porcentaje_inicial` stores it, and both charges are derived from it: the initial share is rounded to the cent and the balance is the remainder, so the two always sum to the invoice.
- The customer starts the initial Stripe payment after invoicing; the Colombia team initiates the balance Stripe link at delivery or records cash/transfer. A customer who paid 100 percent up front has no balance, and the Colombia team confirms delivery without collecting.
- The customer confirms a Colombia delivery address before the 65 percent Checkout opens.
- The seller creates one labelled individual shipment after the 65 percent payment.
- USA operations attaches prepared shipments to a consolidated box with one courier/tracking number.
- Colombia confirms physical receipt from the digital manifest, then collects the final balance and confirms delivery.
- Each consolidated box shows a settlement summary: total collected on delivery, the Stripe portion (US LLC revenue), and the cash/transfer portion that stays in Colombia as the local team's operating fund. This is accounting metadata only; the system never moves money between the two legal entities.
- A booking whose customer requested a local Brash3D SAS invoice is flagged through the seller panel and the Colombia manifest, so the team knows which orders need one.

## UI

- Shared shadcn/ui primitives are kept in `src/components/ui`.
- The seller shell uses the shadcn sidebar and table primitives.
- `next-themes` controls the global light, dark, and system modes.

## Persistence Boundary

`src/lib/store/sessionStore.ts` and `src/lib/store/shippingStore.ts` are the PostgreSQL repository boundary. `src/lib/db.ts` owns the shared connection pool. Docker provides PostgreSQL locally, while tracked numbered SQL migrations provide a path to a managed PostgreSQL production service.
