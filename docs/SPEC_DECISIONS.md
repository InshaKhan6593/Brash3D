# Specification decisions

Where the build differs from `Brash3D_Design_and_Technical_Spec.md`, and why.

Most entries below are places the specification **contradicts itself**. They were
resolved during implementation rather than built as written. One entry (§2 / §8
customer authentication) still needs a decision from the client.

---

## 1. The invoice must not be computed in the browser

**Specification, §3 vs §6.** Section 3 lists the rates under "Environment
variables (backend)" with the note "backend only, never expose in the frontend":

```
TAX_RATE_FL=0.07
FEE_RATE=0.15
```

Section 6's `cerrarSesion()` then runs inside `panelVendedor.js` — the frontend —
and reads `NEXT_PUBLIC_TAX_RATE_FL` / `NEXT_PUBLIC_FEE_RATE`. It computes
`subtotal`, `impuesto`, `comision` and `total` in the browser and writes them
straight into `sesiones_compra`.

**Why that matters.** Anyone holding the anon key could write any total they
liked. The invoice is the amount Stripe charges, so this is a direct financial
exposure, not a style preference.

**Resolved:** totals are computed in PostgreSQL (`recalculateTotals`), never in
any browser. The rates stay server-side as section 3 intended, and each session
stores the rates it was priced with, so a later rate change cannot silently
reprice an invoice the customer has already been quoted.

---

## 2. Row Level Security depends on customer accounts the specification never creates

**Specification, §2 and §8.** The schema defines:

```sql
auth_user_id uuid references auth.users(id), -- links to Supabase auth, used by RLS
```

and all five §8 policies are scoped on `auth_user_id = auth.uid()`. But no
section describes customer signup or login. Section 5's booking flow only
inserts a row into `clientes`.

**Why that matters.** As written, every §8 policy matches nothing, and every
customer sees an empty cart.

**Resolved for now:** customer data is protected by server-side authorization
instead. Customers receive a secure link whose token is stored only as a SHA-256
hash and exchanged for an HTTP-only cookie. No database key of any kind reaches
a browser, so there is no anon key for RLS to constrain.

**Still needs a client decision.** If we adopt Supabase Realtime (see 8 below),
customers need a real `auth.uid()`. Supabase Auth magic links fit the existing
passwordless model almost exactly, but customers would receive a Supabase
authentication email rather than the current link. That is a visible change to
the customer experience and the client should approve it.

---

## 3. The specification disagrees with itself about client-side data access

**Specification, §4 and §7 vs §12.2.** Sections 4 and 7 put the anon key in the
browser and read from Supabase directly. Section 12.2 then says purchase history

> should still run behind the service role key on the backend, with the caller's
> identity checked before querying, not exposed directly to the frontend with the
> anon key.

**Resolved:** the stricter reading was applied everywhere. All reads and writes
are server-mediated and authorized per request.

**Note for the Supabase migration:** subscribing to realtime updates does *not*
require moving writes into the browser. A read-only subscription under RLS is
enough. Writes stay on the server regardless.

---

## 4. The hold-release job cannot be built on the specified schema

**Specification, §5.** Asks for a scheduled job releasing slots for `reservas`
"older than, say, 15 minutes with `reserva_pagada = false`". The `reservas` table
in section 2 has no expiry column, and `reserva_pagada` defaults to false, so the
job as described would release slots out from under customers who are still
completing checkout.

**Resolved:** `reservas.hold_expires_at` was added, with an atomic release, a
partial unique index preventing two confirmed bookings on one slot, and a
constraint keeping the hold state internally consistent. Hold length is
configurable through `STRIPE_BOOKING_HOLD_MINUTES` (5–30, default 15).

Holds are released whenever slots are read or a booking is attempted, rather
than by a cron job. This is self-healing but leaves an abandoned slot locked
until somebody loads the page. See "Remaining" item 7 in
[Implementation status](IMPLEMENTATION_STATUS.md).

---

## 5. Delivery must not be marked complete before the card clears

**Specification, §10.** `/confirmar-entrega` sets `estado: 'entregado'` for every
payment method, including `stripe`, before the Stripe charge is confirmed. The
same section leaves the sequencing open:

> decide up front whether the courier, the local team, or the customer is the one
> who marks a shipment delivered

**Why that matters.** A declined card would leave an order recorded as delivered
*and* booked as US LLC revenue.

**Resolved:** the local team owns delivery confirmation. A shipment must reach
`recibido_equipo_local` before any final payment can start. Cash and transfer are
recorded immediately, because the money is physically in hand. Stripe is marked
delivered only by the signed `payment_intent`/checkout webhook, never optimistically.

---

## 6. Referral rewards could be farmed

**Specification, §12.1.** Deduplicates rewards by `reserva_id`. A referred
customer's *second* booking carries a different `reserva_id`, so it would grant
the referrer another reward — contradicting §14:

> Referral rewards should only trigger on a real paid session (`pagada_inicial`),
> never just on signup or booking — otherwise the program is trivial to abuse.

**Resolved:** rewards are deduplicated by `referido_id` (one reward per referred
person, enforced by a unique index), granted only on that person's first
confirmed 65 percent payment, and self-referral is rejected. Section 14's
suggested monthly cap is implemented as `REFERRAL_REWARD_MONTHLY_CAP`
(default 3).

---

## 7. The WhatsApp 24-hour window claim needs verifying with Meta

**Specification, §7.1.**

> Since the customer initiated the call, the 24-hour customer service window is
> open, so a plain text message can be sent freely — no pre-approved template
> required.

Meta's 24-hour customer service window opens on an inbound **message** to the
business number. A WhatsApp call is not a message, and WhatsApp Business Calling
is a separate product surface from Cloud API messaging.

**Action:** confirm with Meta before building §7.1. If the window is not open,
the first message of each session needs an approved template. This changes the
integration's shape, so it should be settled before work starts rather than
discovered during it.

---

## 8. Platform: Supabase, and what that does and does not mean

**Specification, §1 and §2** call for Supabase (Postgres + Realtime), with the
schema run in the Supabase SQL editor.

**Current state: the database is hosted on Supabase** (`us-east-1`, accessed
through the pooler), with all sixteen tracked migrations applied and row level
security enabled on every public table. Docker Compose still serves local
development and the test suite. What remains unused is Supabase's *products*:
the app connects over `pg` as the table owner, so Auth and Realtime are not in
play and no key of any kind reaches a browser. The session views still poll
every 1.5 seconds.

**Agreed direction — Supabase Postgres and Realtime, with server-authoritative
writes.** This gives the client everything section 1 asked for without inheriting
contradiction 1:

- Host the database on Supabase (§1, §2) — **done**
- RLS on customer-readable tables as defence in depth (§8, §14) — **done as a
  deny-all floor** in migration 015; per-customer policies wait on the identity
  below
- Subscribe read-only to the customer's cart via Realtime, replacing polling (§7)
- Supabase Auth magic links to create the `auth.uid()` that RLS needs (resolves 2)
- **Every write stays on the server**, so the invoice can never be set from a browser

The last two are a pair, and both wait on the client decision recorded in 2
above: a customer would begin receiving a Supabase authentication email in place
of today's secure link.

### Migration readiness

One real blocker was found and fixed. Every Supabase project ships with a
`supabase_realtime` publication already created, so migration 001's
`CREATE PUBLICATION supabase_realtime` aborts the very first migration. The
migration runner now drops that pre-created publication **only when the target
database is completely empty** — no `clientes` table and no `schema_migrations`
rows — leaving existing databases and their recorded checksums untouched.
Verified against a database seeded to imitate a fresh Supabase project: 001
failed before the fix, every migration applied after it.

Connecting also requires TLS, and two details of it were wrong when this was
first written.

**`sslmode` in the connection string does nothing here.** `pg` only reads it
when no `ssl` option is passed, and `src/lib/db-ssl.mjs` always passes one, so
`?sslmode=verify-full` is inert. TLS is decided by that module: a local host
connects in the clear, every other host verifies.

**Verifying against the system trust store fails.** Supabase signs database
certificates with its own private root, which no system store carries, so
verification stops at `SELF_SIGNED_CERT_IN_CHAIN`. The root is committed at
`certs/supabase-root-2021.crt` (valid to April 2031) and pinned through
`DATABASE_SSL_CA_FILE`, or `DATABASE_SSL_CA` with the PEM inline where a host
takes only environment values. `DATABASE_SSL=no-verify` would encrypt without
authenticating the server, on the connection that carries payment records.

**Which pooler port depends on the host.** Port 5432 leases a connection for a
whole session and suits a long-running host; 6543 leases it per transaction and
suits a serverless one, where every concurrent instance pools separately and
`DATABASE_POOL_MAX` should be 1. This project has no direct-connection option to
weigh against them: `db.<ref>.supabase.co` no longer resolves, since Supabase
withdrew dedicated IPv4 addresses from free projects. Nothing in the codebase
holds a session-level setting, an advisory lock or a named prepared statement,
so transaction pooling is safe.

`npm run db:check` verifies all of this against whatever `DATABASE_URL` points
at, without writing anything.

---

## 9. Smaller deliberate deviations

| Specification | Built instead | Reason |
| --- | --- | --- |
| Payment Intents confirmed with Stripe.js (§9, §9.2) | Hosted Stripe Checkout | No card fields in the app; far smaller PCI surface. Still three charges, as specified. |
| Separate Node/Express backend (§1) | Next.js route handlers | One deployable unit; the specification allows "or Supabase Edge Functions", so the backend shape was left open. |
| `reservar_slot()` Postgres RPC (§5) | The same locking inside a TypeScript transaction | Identical guarantees; keeps the hold logic beside the code that owns it. |
| Spanish table and column names (§2) | Kept exactly as specified | Matches the business's internal language. |

---

## 10. The 65/35 split is set per order, not fixed

**Not in the specification.** Section 1 states the split as "65% when the session
closes, and the remaining 35% on delivery", and that is what was first built.

The client then clarified in writing that the figure varies by customer:

> you can put the % that we can do it manually.. if we find the costumer that
> pays right away the 100% much better but if there is someone that pays 85% and
> the 15 when the products are deliver ok… or someone that works for 65% and 35%

**Resolved:** `sesiones_compra.porcentaje_inicial` stores the up-front share per
order, and the seller sets it when closing the session. The columns that encoded
the old assumption were renamed (`monto_pagado_65` became `monto_pagado_inicial`,
and so on) while no production data existed.

Two details worth recording:

- **The charges are derived by subtraction.** The up-front share is rounded to
  the cent and the balance is the remainder, so the two always add up to the
  invoice exactly. Rounding both independently could drift a cent.
- **A 100 percent order has no second payment.** No balance checkout can be
  opened for it, and the Colombia team confirms delivery without collecting
  anything. The package still travels the full receipt-then-delivery path,
  because the goods still have to be handed over.

**Still open with the client:** whether "some people charge a minimum according
the orders" means a fixed dollar minimum as well as a percentage. The current
build is percentage-only.

---

## 11. Latin America beyond Colombia

**Not in the specification.** Section 1 and the designs assume Colombia. The
client described the courier step as sending products "to colombia or any Latin
america country".

**Current state:** the schema already carries `pais` on `clientes`,
`equipos_locales` and `cajas_consolidadas`, so the data model supports it. What
is Colombia-specific is presentational: the city picker, the `es-CO` formatting,
and a single seeded local team. Deferred until a second country is actually
planned.

---

## 12. The WhatsApp 24-hour window, revisited

Entry 7 flagged that section 7.1's claim about the messaging window needed
checking with Meta. It has now been checked against Meta's published platform
documentation, and two things in that section are wrong.

**A video call does not open the messaging window.** The 24-hour customer
service window opens when the customer sends a *message* to the business number.
WhatsApp Business Calling is a separate surface from Cloud API messaging. Without
an inbound message, every product echo would have to be a pre-approved template.

**"Freely" was about template approval, not cost.** The specification says a
plain text message "can be sent freely — no pre-approved template required". The
clause after the dash defines the word: it means no template approval is needed.
The specification does not discuss messaging cost anywhere, so there is no
client requirement that messaging be free.

**Resolved:** the customer opens the window themselves with one tap. The booking
confirmation carries a `wa.me` link with prefilled text; once tapped, every
product echo for that session is a free-form message inside an open window,
exactly as section 7.1 intended — and for the right reason.

Meta also begins charging for service messages from 1 October 2026, with a free
tier of 1,000 per business phone number per month. At this project's expected
volume that is a negligible cost, but it is a change of model rather than a rate
change. See [WhatsApp integration plan](WHATSAPP.md).
