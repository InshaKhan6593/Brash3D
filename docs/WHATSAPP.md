# WhatsApp integration plan

Specification section 7.1 asks for a WhatsApp echo of each product as the seller
adds it. Nothing is built yet. This document records what the platform actually
allows, what it costs, and the options — because the specification's assumptions
about both turned out to be wrong.

## The rule that shapes everything

A business can only send a **free-text** message (`type: "text"`) inside an open
**24-hour customer service window**. That window opens when the *customer* sends
a message, and resets with each further message from them. Outside it, the API
rejects free text with a re-engagement error, and the only way to reach someone
is a **pre-approved template**.

Two consequences the specification did not anticipate:

1. **A WhatsApp video call does not open the window.** Section 7.1 states that
   "since the customer initiated the call, the 24-hour customer service window is
   open, so a plain text message can be sent freely — no pre-approved template
   required." The window opens on an inbound *message*, not a call, and WhatsApp
   Business Calling is a separate surface from Cloud API messaging.
2. **"Freely" in that sentence means "without template approval", not "at no
   cost".** The specification never discusses messaging cost anywhere.

## Cost, and a date that matters

Meta charges the **business**, never the recipient. Inbound messages from
customers are always free.

Pricing moved from per-conversation to **per-delivered-template-message** on
1 July 2025. More importantly for this project:

- **Today:** free-text inside an open window is free and unlimited; utility
  templates inside an open window are also free.
- **From 1 October 2026:** Meta begins charging for service messages, with a
  free tier of **1,000 service messages per business phone number per month**,
  and also begins charging for utility templates sent inside an open window.

Rates follow the **recipient's** country code, so Colombia's rate is the one that
matters. Pull it from Meta's live rate card before budgeting; rates are revised
quarterly.

Rough scale check at 100 orders per month: about 800 product-echo messages
(inside the free tier) plus roughly 400 status templates. Even at several times
the United States utility rate this stays under about 10 USD per month — small
against a 20 USD booking fee plus 15 percent commission. Cost should not drive
the design here.

## Three options

### Option A — no templates, no cost (recommended first step)

- The booking confirmation carries a `wa.me` link with prefilled text. One tap
  from the customer opens the 24-hour window.
- Every product echo during the session goes as free text.
- Status updates are **not** pushed over WhatsApp. The customer already has the
  live order page with the full timeline.
- Delivery coordination happens through the WhatsApp button in the Colombia
  panel, which opens the team member's own WhatsApp. No API, no cost.

Needs no template approvals and no Business Verification to build or demo.

### Option B — one template to bridge the silent gap

Option A plus a single utility template when a box ships, worded to invite a
reply. Once the customer answers, the window reopens and everything after it is
free text again.

### Option C — a template per status event

Fully automatic push for shipped / arrived / out for delivery. Roughly four
template messages per order.

## Templates to submit, if Option B or C is chosen

Category must be **UTILITY**; marketing rates are several times higher and Meta
reclassifies anything promotional. Keep the wording factual — no offers, no
urgency, no sales copy.

- `pedido_enviado` (es) — "Hola {{1}}, tu pedido Brash3D salió de Miami. Guía
  {{2}} con {{3}}. Te avisamos cuando llegue a Colombia."
- `caja_recibida_colombia` (es) — "Hola {{1}}, tu pedido ya llegó a Colombia y
  está con nuestro equipo local. Pronto coordinamos la entrega."
- `entrega_programada` (es) — "Hola {{1}}, hoy entregamos tu pedido en {{2}}.
  Saldo por cobrar: {{3}}."

## Getting started without waiting on the client

Creating a WhatsApp Business app in Meta for Developers yields a free **test
phone number** and up to five verified test recipients. The 24-hour window rule
applies in testing too, so message the test number from a test handset first,
then the API can send free text to it. A pre-approved `hello_world` template
ships with the test number for exercising the template path.

The code is identical for test and production; only the phone number ID and
access token change.

## What the client has to do

Template approval usually takes hours. **Business Verification takes
considerably longer and is the item most likely to delay launch**, because
nothing can be sent to anyone outside the five test recipients until it
completes:

Meta Business Account → Business Verification → production number registered →
display-name approval → templates approved.

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
