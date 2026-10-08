/**
 * Renders the customer's booking confirmation email for the walkthrough video,
 * exactly as the app builds it, inside a plain inbox view -- so the video can
 * show what arrives after booking without sending anything to anyone.
 *
 *   npx tsx scripts/demo/render-booking-email.tsx <input.json> <output.html>
 *
 * The input is the booking: customerName, customerEmail, customerPhone,
 * customerCity, store, startsAt (ISO), durationMinutes, amountPaid, orderUrl.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { DEFAULT_COUNTRY } from "@/lib/countries"
import { customerBookingEmail, LOGO_CID } from "@/lib/email/booking-email"
import { googleCalendarUrl } from "@/lib/email/calendar"
import { MI_GLOBAL_SHOPPER_LOGO_PNG_BASE64 } from "@/lib/email/logos"

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2)
  if (!inputPath || !outputPath) throw new Error("Usage: render-booking-email.tsx <input.json> <output.html>")
  const input = JSON.parse(readFileSync(inputPath, "utf8"))

  const startsAt = new Date(input.startsAt)
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000)
  const calendarUrl = googleCalendarUrl({
    uid: "demo@brash3d",
    start: startsAt,
    end: endsAt,
    title: `Sesión de compra en vivo · ${input.customerName}`,
    description: "Videollamada por WhatsApp con tu comprador personal de Mi Global Shopper. Tu carrito en vivo:",
    location: "Videollamada de WhatsApp",
    url: input.orderUrl,
    organizer: { name: "Mi Global Shopper", email: "demo@brash3d.test" },
    attendee: { name: input.customerName, email: input.customerEmail },
  })

  const email = await customerBookingEmail({
    customerName: input.customerName,
    startsAt,
    durationMinutes: input.durationMinutes,
    amountPaid: input.amountPaid,
    orderUrl: input.orderUrl,
    calendarUrl,
    customerTimeZone: DEFAULT_COUNTRY.timeZone,
    customerPhone: input.customerPhone,
    customerCity: input.customerCity,
    store: input.store,
  })

  // The real message carries the logo as an attachment referenced by `cid:`.
  const body = email.html.replaceAll(`cid:${LOGO_CID}`, `data:image/png;base64,${MI_GLOBAL_SHOPPER_LOGO_PNG_BASE64}`)
  const escape = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
  const when = new Intl.DateTimeFormat("es-CO", { dateStyle: "full", timeStyle: "short", timeZone: DEFAULT_COUNTRY.timeZone }).format(startsAt)

  writeFileSync(outputPath, `<!doctype html>
  <html lang="es"><head><meta charset="utf-8"><title>Bandeja de entrada</title>
  <style>
    * { box-sizing: border-box }
    body { margin: 0; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2328; background: #eef1f5 }
    .bar { position: sticky; top: 0; z-index: 1; height: 56px; display: flex; align-items: center; gap: 12px; padding: 0 24px; background: #fff; border-bottom: 1px solid #dde2e8; font-weight: 600 }
    .bar span { font-weight: 400; color: #687280 }
    .wrap { display: grid; grid-template-columns: 300px 1fr; min-height: calc(100vh - 56px) }
    .list { background: #fff; border-right: 1px solid #dde2e8; overflow: hidden }
    .item { padding: 14px 18px; border-bottom: 1px solid #eef1f5 }
    .item.active { background: #eaf2ff; border-left: 3px solid #2f6fdb }
    .item b { display: block } .item small { color: #687280 }
    .read { padding: 22px 28px }
    .head { background: #fff; border: 1px solid #dde2e8; border-radius: 10px; padding: 16px 20px; margin-bottom: 14px }
    .head h1 { margin: 0 0 6px; font-size: 19px }
    .meta { color: #687280 }
    .invite { display: flex; align-items: center; gap: 14px; margin-top: 12px; padding: 12px 14px; border: 1px solid #cfe0fb; background: #f4f8ff; border-radius: 8px }
    .invite .cal { width: 44px; height: 44px; border-radius: 8px; background: #2f6fdb; color: #fff; display: grid; place-items: center; font-weight: 700 }
    .invite small { color: #687280 }
    .chip { display: inline-block; margin-top: 10px; padding: 4px 10px; border: 1px solid #dde2e8; border-radius: 999px; background: #fff; color: #4a5361 }
    iframe { width: 100%; border: 1px solid #dde2e8; border-radius: 10px; background: #fff; height: 1400px }
  </style></head>
  <body>
    <div class="bar">Bandeja de entrada <span>· ${escape(input.customerEmail)}</span></div>
    <div class="wrap">
      <div class="list">
        <div class="item active"><b>Mi Global Shopper</b>${escape(email.subject)}<br><small>Ahora</small></div>
      </div>
      <div class="read">
        <div class="head">
          <h1>${escape(email.subject)}</h1>
          <div class="meta"><b>Mi Global Shopper</b> · para ${escape(input.customerName)}</div>
          <div class="invite"><div class="cal">${startsAt.toLocaleDateString("es-CO", { day: "numeric", timeZone: DEFAULT_COUNTRY.timeZone })}</div>
            <div><b>Invitación: Sesión de compra en vivo</b><br><small>${escape(when)} (hora de Colombia) · Videollamada de WhatsApp</small></div></div>
          <span class="chip">📎 cita.ics</span>
        </div>
        <iframe id="email" srcdoc="${escape(body)}"></iframe>
      </div>
    </div>
  </body></html>`)
  console.log(outputPath)
}

void main()
