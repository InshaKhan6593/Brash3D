import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  pixelBasedPreset,
  Preview,
  render,
  Row,
  Section,
  Tailwind,
  Text,
} from "@react-email/components"
import type { ReactNode } from "react"
import { OUTLET_TIME_ZONE } from "@/lib/appointment"
import { formatDuration } from "@/lib/booking-duration"

/**
 * The booking confirmation emails: one to the customer (Spanish, the approved
 * customer language) and one to the seller (English, like the staff
 * dashboard).
 *
 * Built with React Email in the style of its Vercel template -- white, a thin
 * grey border, a black button -- which renders to the table-and-inline-style
 * HTML every mail client accepts. The logo is embedded in the message
 * (`cid:`), never linked; see `logos.ts`.
 *
 * The plain-text versions are written by hand rather than derived from the
 * HTML, so they read as a message rather than as stripped markup.
 */

export interface BookingEmailInput {
  customerName: string
  startsAt: Date
  durationMinutes: number
  /** What was charged for the booking; 0 when a referral reward covered it. */
  amountPaid: number
  orderUrl: string
  calendarUrl: string
  /** The customer's own zone, for the second clock. */
  customerTimeZone: string
  customerPhone: string
  customerCity?: string
  /** The store the customer asked for. */
  store?: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/** The `content_id` the sender attaches the logo under. */
export const LOGO_CID = "mi-global-shopper-logo"

const BRAND = "Mi Global Shopper"

function money(amount: number): string {
  return `${amount.toFixed(2)} USD`
}

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

/** Every way the appointment is written, on the outlet's clock and the customer's. */
function when(input: BookingEmailInput, locale: string) {
  const end = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000)
  const time = (date: Date, timeZone: string) =>
    date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone })
  const date = input.startsAt.toLocaleDateString(locale, {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: OUTLET_TIME_ZONE,
  })
  const florida = `${time(input.startsAt, OUTLET_TIME_ZONE)} – ${time(end, OUTLET_TIME_ZONE)}`
  const local = `${time(input.startsAt, input.customerTimeZone)} – ${time(end, input.customerTimeZone)}`
  return { date: date.charAt(0).toUpperCase() + date.slice(1), florida, local, sameClock: florida === local }
}

function Layout({ lang, preview, children }: { lang: string; preview: string; children: ReactNode }) {
  return (
    <Html lang={lang}>
      <Head />
      <Tailwind config={{ presets: [pixelBasedPreset] }}>
        <Body className="mx-auto my-auto bg-white px-2 font-sans">
          <Preview>{preview}</Preview>
          <Container className="mx-auto my-[40px] max-w-[465px] rounded border border-[#eaeaea] border-solid p-[20px]">
            <Section className="mt-[24px]">
              <Img src={`cid:${LOGO_CID}`} width="72" height="72" alt={BRAND} className="mx-auto my-0 rounded-full" />
            </Section>
            {children}
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

/** The appointment, as label/value rows in a quiet grey panel. */
function Details({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <Section className="my-[24px] rounded border border-[#eaeaea] border-solid bg-[#fafafa] px-[16px] py-[8px]">
      {rows.map((row, index) => (
        <Row key={row.label} className={index < rows.length - 1 ? "border-[#eaeaea] border-b border-solid" : undefined}>
          <Column className="w-[42%] py-[10px] align-top text-[#666666] text-[13px] leading-[20px]">{row.label}</Column>
          <Column className="py-[10px] align-top font-semibold text-[13px] text-black leading-[20px]">{row.value}</Column>
        </Row>
      ))}
    </Section>
  )
}

function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section className="mt-[8px] mb-[24px] text-center">
      <Button className="rounded bg-[#000000] px-5 py-3 text-center font-semibold text-[13px] text-white no-underline" href={href}>
        {children}
      </Button>
    </Section>
  )
}

function CustomerEmail({ input }: { input: BookingEmailInput }) {
  const time = when(input, "es-CO")
  const paid = input.amountPaid > 0 ? money(input.amountPaid) : "Cubierta con tu recompensa"
  return (
    <Layout lang="es" preview={`${time.date} · ${time.florida} hora de Florida`}>
      <Heading className="mx-0 my-[30px] p-0 text-center font-normal text-[24px] text-black">
        Tu sesión de compra en vivo está <strong>confirmada</strong>
      </Heading>
      <Text className="text-[14px] text-black leading-[24px]">Hola <strong>{firstNameOf(input.customerName)}</strong>,</Text>
      <Text className="text-[14px] text-black leading-[24px]">
        Tu comprador personal te hará una videollamada por WhatsApp desde la tienda a la hora de tu cita. Durante la llamada verás tu carrito actualizarse en vivo.
      </Text>
      <Details rows={[
        { label: "Fecha", value: time.date },
        { label: "Hora de Florida (Miami)", value: time.florida },
        ...(time.sameClock ? [] : [{ label: "Hora en Colombia", value: time.local }]),
        ...(input.store ? [{ label: "Tienda", value: input.store }] : []),
        { label: "Duración", value: formatDuration(input.durationMinutes) },
        { label: "Reserva", value: paid },
      ]} />
      <PrimaryButton href={input.orderUrl}>Ver mi pedido</PrimaryButton>
      <Text className="text-[14px] text-black leading-[24px]">
        o copia este enlace en tu navegador:{" "}
        <Link href={input.orderUrl} className="break-all text-blue-600 no-underline">{input.orderUrl}</Link>
      </Text>
      <Text className="text-[14px] text-black leading-[24px]">
        <Link href={input.calendarUrl} className="text-blue-600 no-underline">Agregar a Google Calendar</Link>
        {" "}· la invitación adjunta funciona con Outlook y Apple Calendar.
      </Text>
      <Hr className="mx-0 my-[26px] w-full border border-[#eaeaea] border-solid" />
      <Text className="text-[#666666] text-[12px] leading-[24px]">
        Este enlace es personal, no lo compartas. ¿Necesitas cambiar tu cita? Responde a este correo.
        <br />
        <strong>{BRAND}</strong> es una marca de Brash3D Technologies.
      </Text>
    </Layout>
  )
}

function SellerEmail({ input }: { input: BookingEmailInput & { sellerPanelUrl: string } }) {
  const time = when(input, "en-US")
  return (
    <Layout lang="en" preview={`${time.date}, ${time.florida} Florida time`}>
      <Heading className="mx-0 my-[30px] p-0 text-center font-normal text-[24px] text-black">
        New booking from <strong>{input.customerName}</strong>
      </Heading>
      <Text className="text-[14px] text-black leading-[24px]">
        A live shopping session was booked and paid. The calendar invite is attached.
      </Text>
      <Details rows={[
        { label: "Date", value: time.date },
        { label: "Florida time", value: time.florida },
        ...(input.store ? [{ label: "Store", value: input.store }] : []),
        { label: "Length", value: formatDuration(input.durationMinutes) },
        { label: "Booking fee", value: input.amountPaid > 0 ? money(input.amountPaid) : "Referral reward" },
        {
          label: "WhatsApp",
          value: <Link href={`https://wa.me/${input.customerPhone.replace(/\D/g, "")}`} className="text-blue-600 no-underline">{input.customerPhone}</Link>,
        },
        { label: "City", value: input.customerCity || "—" },
      ]} />
      <PrimaryButton href={input.sellerPanelUrl}>Open live session</PrimaryButton>
      <Text className="text-center text-[14px] leading-[24px]">
        <Link href={input.calendarUrl} className="text-blue-600 no-underline">Add to Google Calendar</Link>
      </Text>
      <Hr className="mx-0 my-[26px] w-full border border-[#eaeaea] border-solid" />
      <Text className="text-[#666666] text-[12px] leading-[24px]">
        {BRAND} · Brash3D Technologies staff notification.
      </Text>
    </Layout>
  )
}

export async function customerBookingEmail(input: BookingEmailInput): Promise<RenderedEmail> {
  const time = when(input, "es-CO")
  const name = firstNameOf(input.customerName)
  const duration = formatDuration(input.durationMinutes)
  const text = [
    `Hola ${name}, tu sesión de compra en vivo está confirmada.`,
    "",
    `Fecha: ${time.date}`,
    `Hora de Florida (Miami): ${time.florida}`,
    ...(time.sameClock ? [] : [`Hora en Colombia: ${time.local}`]),
    ...(input.store ? [`Tienda: ${input.store}`] : []),
    `Duración: ${duration}`,
    `Reserva pagada: ${input.amountPaid > 0 ? money(input.amountPaid) : "cubierta con tu recompensa de referido"}`,
    "",
    `Ver mi pedido: ${input.orderUrl}`,
    `Agregar a Google Calendar: ${input.calendarUrl}`,
    "",
    "Tu comprador personal te hará una videollamada por WhatsApp desde la tienda a la hora de tu cita.",
    "¿Necesitas cambiar tu cita? Responde a este correo.",
    "",
    `${BRAND} · una marca de Brash3D Technologies`,
  ].join("\n")
  return {
    subject: `Tu sesión de compra en vivo está confirmada · ${time.date}`,
    html: await render(<CustomerEmail input={input} />),
    text,
  }
}

export async function sellerBookingEmail(input: BookingEmailInput & { sellerPanelUrl: string }): Promise<RenderedEmail> {
  const time = when(input, "en-US")
  const text = [
    `New booking: ${input.customerName}`,
    `Date: ${time.date}`,
    `Florida time: ${time.florida}`,
    ...(input.store ? [`Store: ${input.store}`] : []),
    `Length: ${formatDuration(input.durationMinutes)}`,
    `Booking fee: ${input.amountPaid > 0 ? money(input.amountPaid) : "Referral reward"}`,
    `WhatsApp: ${input.customerPhone}`,
    `City: ${input.customerCity || "-"}`,
    "",
    `Open live session: ${input.sellerPanelUrl}`,
  ].join("\n")
  return {
    subject: `New booking: ${input.customerName} · ${time.date}, ${time.florida}`,
    html: await render(<SellerEmail input={input} />),
    text,
  }
}
