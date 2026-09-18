# WhatsApp integration plan

Specification section 7.1 asks for a WhatsApp echo of each product as the seller
adds it. This document records what the platform actually allows, what it costs,
and how the app is wired — because the specification's assumptions about the
first two turned out to be wrong.

**Built:** the send adapter, the product echo with an automatic template
fallback, the customer's consent switch, the `wa.me` chat link carrying their
order link, the inbound webhook, and the 24-hour window state the seller panel
reads. **Not built:** sending the booking confirmation, which waits on an
approved template.

## The rule that shapes everything

A business can only send a **free-text** message (`type: "text"`) inside an open
**24-hour customer service window**. That window opens when the *customer* sends
a message, and resets with each further message from them. Outside it, the API
rejects free text with a re-engagement error, and the only way to reach someone
is a **pre-approved template**.

Two consequences the specification did not anticipate:

1. **The video call the seller actually makes does not open the window.**
   Section 7.1 states that "since the customer initiated the call, the 24-hour
   customer service window is open, so a plain text message can be sent freely —
   no pre-approved template required."

   Calls *can* open the window, but only a narrow kind. Meta's rule is that the
   window opens or refreshes when a user messages the business, when a user calls
   the business (even unanswered), or when a user answers a call the business
   placed — and in all three cases through the **Business Calling API**, on the
   business phone number registered to Cloud API. That API is **voice only; it
   does not carry video**, and an ordinary WhatsApp call between two consumer
   accounts is not it.

   Brash3D's call is a WhatsApp *video* call from the seller's own handset, which
   is the whole point of the product — the customer watches the seller walk the
   outlet. So it is doubly outside the rule: wrong surface, and a medium the
   Calling API does not support. The specification's conclusion is wrong even
   though its instinct, that a call ought to count, has since become half true.
2. **"Freely" in that sentence means "without template approval", not "at no
   cost".** The specification never discusses messaging cost anywhere.

## Cost, and a date that matters

Meta charges the **business**, never the recipient. Inbound messages from
customers are always free.

Pricing moved from per-conversation to **per-delivered-template-message** on
1 July 2025. More importantly for this project:

- **Until 30 September 2026:** free-text inside an open window is free and
  unlimited; utility templates inside an open window are also free.
- **From 1 October 2026:** Meta charges per message for service messages — the
  free-form replies sent inside the 24-hour window, which is exactly what the
  product echo is — and for utility templates sent inside an open window.
  Each business phone number gets **1,000 free service messages per calendar
  month**, not shared across numbers, not rolled over. Billing starts at the
  1,001st. Service messages are billed at the market's **utility** rate, and
  Meta's published note is that no volume discount applies to them.

Rates follow the **recipient's** country code, so Colombia's is the one that
matters, and Colombia is among the cheapest markets on the card:
**0.0008 USD per message**. Rates are revised periodically — the card in force
when this was written is dated 1 July 2026 — so re-read it before budgeting.

**Scale check.** At 100 orders per month with eight items each, the product echo
is about 800 messages, inside the free tier before a cent is charged. The cost
only becomes real at volume, and barely then: 12,500 messages in a month is
11,500 billable at 0.0008, or **about 9 USD**. Against a 20 USD booking fee plus
commission on every order, cost cannot sensibly drive any decision here. What
the 1 October change actually costs this project is nothing; what it changes is
that the meter now exists at all.

## Three options

### Option A — no templates (recommended first step)

- The booking confirmation carries a `wa.me` link with prefilled text. One tap
  from the customer opens the 24-hour window.
- Every product echo during the session goes as free text.
- Status updates are **not** pushed over WhatsApp. The customer already has the
  live order page with the full timeline.
- Delivery coordination happens through the WhatsApp button in the Colombia
  panel, which opens the team member's own WhatsApp. No API involved.

Needs no template approvals and no Business Verification to build or demo.

Free until 1 October 2026, and effectively free after it: the echoes are service
messages, so the first 1,000 a month cost nothing and the rest are 0.0008 USD
each to Colombia. Option A is the recommendation because it avoids template
*review*, not because it dodges a bill.

### Option B — one template to bridge the silent gap

Option A plus a single utility template when a box ships, worded to invite a
reply. Once the customer answers, the window reopens and everything after it is
free text again.

### Option C — a template per status event

Fully automatic push for shipped / arrived / out for delivery. Roughly four
template messages per order.

## The templates to submit

Category must be **UTILITY** for all three. Marketing rates are several times
higher and Meta reclassifies anything that reads promotional, so the wording
stays factual -- no offers, no urgency, no sales copy.

A template's shape is fixed at approval. Variables can carry anything, but a
field cannot be added later without a new template and a new review, which is
why the product template folds quantity into the product parameter rather than
taking a third one.

### 1. `reserva_confirmada` -- sent when the booking is paid

Closes the gap that matters most: the customer books days ahead and keeps no
browser tab, so without this their order link exists only in a page they are
about to close.

```
Hola {{1}}, tu sesión de compra en vivo con Brash3D está confirmada.

Cita: {{2}}
Outlet: {{3}}

Guarda este chat. Aquí te llegará tu carrito en vivo durante la videollamada.
```

- `{{1}}` customer's first name · `{{2}}` date and time · `{{3}}` outlet
- **URL button** "Ver mi pedido" → base `https://<host>/session/`, variable
  `<sessionId>?token=<token>`
- **Quick reply** "Confirmar mi cita"

The quick reply is the most important element in any of these. Tapping it sends
a message *from the customer*, which is what opens the 24-hour window -- without
typing, and without them ever learning that Meta has rules.

**Unverified detail:** whether Meta's editor accepts `?` and `=` inside a URL
button variable. If it refuses, the fix is a short redirect route (`/o/{{1}}`
carrying only the token) -- about twenty minutes, and it keeps the link short in
the chat, which is arguably better anyway.

### 2. `producto_agregado` -- the fallback for each product

Only sent when the window is shut. Inside an open window the same product goes
as free text, which is free and reads like an ordinary message.

```
Agregado a tu carrito: {{1}} — ${{2}} USD
```

- `{{1}}` product, with quantity folded in (`2 x Chaqueta Windrunner`)
- `{{2}}` line total

### 3. `sesion_hoy` -- optional reminder on the day

```
Hola {{1}}, hoy es tu sesión de compra en vivo, a las {{2}}.

Responde a este mensaje para recibir tu carrito aquí mientras compramos.
```

- **Quick reply** "Estoy listo"

Worth having, not required: `producto_agregado` already covers the customer who
never writes back. This one simply makes the first product arrive as free text
rather than as a template.

### Wiring them up

`WHATSAPP_TEMPLATE_BOOKING`, `WHATSAPP_TEMPLATE_PRODUCT` and
`WHATSAPP_TEMPLATE_LANGUAGE` hold the approved names, because a template
approved on a test account cannot be reused on the client's. With them unset
only free text is attempted, which is the correct behaviour before any template
exists.

## Getting started without waiting on the client

Creating a WhatsApp Business app in Meta for Developers yields a free **test
phone number** on a developer's own Meta account. No Business Verification, no
display-name review, no cost, and nothing needed from the client.

What the test number gives and withholds:

- **Five recipients.** Up to five phone numbers, each confirmed by an SMS or
  call code. The seller's handset and a spare phone are enough to exercise the
  whole flow. Nobody outside those five can be messaged, and real customers
  cannot message the test number.
- **The window rule still applies.** Message the test number from a test handset
  first; then the API can send free text back for 24 hours. This is the same
  mechanism Option A relies on in production, so testing it proves the design
  rather than working around it.
- **`hello_world`** ships pre-approved, which exercises the template path without
  waiting on a review.
- **Templates do not carry over.** Templates authored against the test number
  cannot be reused on a production number; they have to be created again on the
  client's WABA. Worth knowing before anyone writes a dozen of them.
- **Tokens.** The dashboard token lasts 24 hours and will interrupt any test
  that runs longer. A System User token in Business Settings is the one to use
  for anything beyond a first afternoon.
- **A new portfolio starts at a 250 messaging limit** — unique users reached
  outside the customer service window per 24 hours. Irrelevant at five
  recipients; it matters after the client's number goes live, where Business
  Verification is what raises it to 2,000.

The code is identical for test and production. Only `WHATSAPP_PHONE_NUMBER_ID`
and `WHATSAPP_CLOUD_API_TOKEN` change, which is why building against the test
number costs nothing later.

## What the client has to do

Template approval usually takes hours. **Business Verification takes
considerably longer and is the item most likely to delay launch**, because
nothing can be sent to anyone outside the five test recipients until it
completes:

Meta Business Account → Business Verification → production number registered →
display-name approval → templates approved.

### The constraint to raise with him first

**A number registered to Cloud API stops working in the WhatsApp app.** To
register a number that already has a WhatsApp or WhatsApp Business account, that
account must be deleted first, and its message history is lost. Afterwards the
number cannot be used in WhatsApp Messenger or the Business app at all unless it
is deregistered from Cloud API again.

This lands directly on how Brash3D operates today. The seller runs the business
from WhatsApp by hand — the video call, the booking link, the delivery
coordination — so the number customers already know is almost certainly a number
he uses in the app every day. Handing it to Cloud API takes that away.

Three ways out, in the order worth discussing:

1. **Register a new number** for the API and keep his existing one for calls and
   ad-hoc chat. Cleanest, and the API number is the one that appears as the
   business identity on outbound messages.
2. **Onboard through a BSP that supports Business-app coexistence**, which keeps
   the app and the API on one number and preserves history. Adds a vendor and
   their markup on top of Meta's rates.
3. **Migrate the existing number** and accept that the app stops working on it.

This question should be settled before he starts Business Verification, because
the number is named during that process and changing it afterwards means
redoing display-name approval.

## What the code will need

Section 7.1 only describes sending. Two-way messaging additionally needs:

- An inbound webhook (`GET` verification handshake plus `POST` message events)
  so customer replies are received and the window state is known.
- A per-session message log so staff can see the thread.
- A send adapter that, per the specification, never rolls back the cart insert
  when a send fails — the item still belongs on the invoice.

## Environment variables (not yet used by any code)

```
WHATSAPP_CLOUD_API_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
```
