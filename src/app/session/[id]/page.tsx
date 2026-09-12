"use client"

import { FormEvent, use, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  CreditCard,
  MapPin,
  Package,
  ReceiptText,
  ShoppingBag,
  Truck,
} from "lucide-react"
import { CustomerHeader } from "@/components/customer-header"
import { WhatsAppIcon } from "@/components/whatsapp-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DeliveryCityCombobox } from "@/components/delivery-city-combobox"
import { Separator } from "@/components/ui/separator"
import { PurchaseHistoryTable } from "@/components/purchase-history-table"
import { SESSION_LOAD_FAILED, useSession } from "@/lib/hooks/useSession"
import { copyText } from "@/lib/clipboard"
import { countryFor } from "@/lib/countries"
import { CUSTOMER_ACCESS_PARAM, customerSessionPath } from "@/lib/customer-link"
import { intlLocale, type Locale } from "@/lib/i18n/locale"
import { useLocale } from "@/lib/i18n/provider"
import type { Messages } from "@/lib/i18n/messages"
import { CustomerPurchaseHistory, EnvioEstado } from "@/lib/types"
import { finalAmount, initialAmount, isPaidInFullUpFront } from "@/lib/payment-split"
import { cn, formatCurrency, formatPercent } from "@/lib/utils"

// Two of these name the destination country, so the labels are built per
// customer rather than held in a module-level constant.
function shipmentStatusLabel(estado: EnvioEstado, country: string, t: Messages): string {
  const copy = t.session.shipmentStatus
  switch (estado) {
    case "en_transito": return copy.en_transito(country)
    case "recibido_equipo_local": return copy.recibido_equipo_local(country)
    default: return copy[estado]
  }
}

interface TimelineItem {
  id: string
  title: string
  description: string
  status: "completed" | "current" | "pending"
}

function PurchaseHistoryCard({ history, locale }: { history: CustomerPurchaseHistory | null; locale: Locale }) {
  if (!history) return null
  return <PurchaseHistoryTable history={history} locale={locale} />
}

function ReferralInviteCard({ history, t }: { history: CustomerPurchaseHistory | null; t: Messages }) {
  const [copied, setCopied] = useState(false)

  if (!history) return null
  const code = history.customer.referralCode

  // Sharing the code is the whole point of this card, so it needs a real button
  // rather than an icon; selecting text by hand on a phone is painful.
  async function copyCode() {
    // Through the shared helper so a blocked clipboard cannot show "Copiado"
    // for a copy that never happened.
    if (!await copyText(code)) return setCopied(false)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return <Card>
    <CardHeader>
      <CardTitle className="text-xl">{t.session.referralTitle}</CardTitle>
      <CardDescription>{t.session.referralBody}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-center text-base font-semibold tracking-wide">{code}</code>
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void copyCode()} aria-label={t.session.copyReferral}>
          {/*
            Both icons stay mounted and visibility is toggled in CSS, so this
            button never inserts or removes a DOM node — only text changes.
            It was a ternary returning `<><Check />Copiado</>` against
            `<><Copy />Copiar</>`: React reconciled the two as one Fragment,
            diffed its children by index, and swapped an <svg> while the
            adjacent text node shifted, which surfaced as an insertBefore
            NotFoundError mid-render. Swapping the icon alone still leaves a
            mount/unmount at that position; keeping both removes the operation
            React was failing to perform.
          */}
          <Check aria-hidden className={copied ? undefined : "hidden"} />
          <Copy aria-hidden className={copied ? "hidden" : undefined} />
          {copied ? t.session.copied : t.session.copy}
        </Button>
      </div>
      {history.availableReferralRewards > 0
        ? <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{t.session.rewardsAvailable(history.availableReferralRewards, formatCurrency(history.availableReferralCredit))}</p>
        : <p className="text-sm text-muted-foreground">{t.session.rewardsNone}</p>}
    </CardContent>
  </Card>
}


export default function CustomerSessionPage({ params, searchParams }: PageProps<"/session/[id]">) {
  const { id } = use(params)
  // The customer's access token, when they arrived on a durable link. Client
  // component pages read searchParams through `use`, the same way params are read.
  const query = use(searchParams)
  const urlToken = typeof query[CUSTOMER_ACCESS_PARAM] === "string" ? query[CUSTOMER_ACCESS_PARAM] : null
  const { locale, t } = useLocale()
  // recoverToken: this is the one screen with a customer cookie to fall back
  // on, and the one that needs the token in the address bar.
  const { session, loading, error, pay, recoveredToken } = useSession(id, urlToken, { recoverToken: true })
  const [now, setNow] = useState(() => Date.now())
  const [paymentError, setPaymentError] = useState("")
  const [paymentStarting, setPaymentStarting] = useState(false)
  const [history, setHistory] = useState<CustomerPurchaseHistory | null>(null)
  const activeToken = urlToken || recoveredToken
  const dateLocale = intlLocale(locale, countryFor(session?.cliente.pais).locale)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  /**
   * Puts the access token into the address bar when the page was opened without
   * one — the browser that made the booking, which holds only the cookie.
   *
   * Without this the customer is left looking at a `/session/<id>` that carries
   * no credential: it works here, because this browser has the cookie, but it
   * is useless the moment they copy it to a phone or clear site data. Writing
   * it back makes the URL they would naturally bookmark the portable one.
   *
   * `replaceState` rather than a router navigation: this is the same page with
   * the same data, and pushing an entry would make Back a no-op.
   */
  useEffect(() => {
    if (urlToken || !recoveredToken) return
    window.history.replaceState(null, "", customerSessionPath(id, recoveredToken))
  }, [id, recoveredToken, urlToken])

  useEffect(() => {
    async function loadHistory() {
      const access = activeToken ? `&access=${encodeURIComponent(activeToken)}` : ""
      const response = await fetch(`/api/customer-history?sessionId=${encodeURIComponent(id)}${access}`, { cache: "no-store" })
      if (!response.ok) return
      const data = await response.json() as { history: CustomerPurchaseHistory }
      setHistory(data.history)
    }
    void loadHistory()
  }, [activeToken, id])

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!session) return []

    const copy = t.session.timeline
    const closed = session.estado === "completada"
    const paidInitial = session.montoPagadoInicial > 0
    const paidFinal = session.montoPagadoFinal > 0
    const shipment = session.envio
    const shipped = shipment && shipment.estado !== "preparacion"
    const delivered = shipment?.estado === "entregado"
    const country = countryFor(session.cliente.pais).name

    return [
      { id: "booked", title: copy.booked, description: copy.bookedBody, status: "completed" },
      { id: "shopping", title: copy.shopping, description: closed ? copy.shoppingClosed : copy.shoppingLive, status: closed ? "completed" : "current" },
      { id: "initial", title: copy.initial, description: paidInitial ? copy.initialPaid(formatCurrency(session.montoPagadoInicial)) : copy.initialPending, status: paidInitial ? "completed" : closed ? "current" : "pending" },
      { id: "shipping", title: copy.shipping(country), description: shipped ? copy.shippingActive : copy.shippingPending, status: delivered ? "completed" : paidInitial ? "current" : "pending" },
      { id: "delivery", title: copy.delivery, description: paidFinal ? copy.deliveryPaid : delivered ? copy.deliveryConfirmed : session.porcentajeInicial >= 100 ? copy.deliveryPrepaid : copy.deliveryPending, status: paidFinal ? "completed" : delivered ? "current" : "pending" },
    ]
  }, [session, t])

  if (loading) {
    return (
      <div className="min-h-screen">
        <CustomerHeader />
        <main className="flex min-h-[70vh] items-center justify-center">
          <div className="text-center"><div className="mx-auto mb-3 size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /><p className="text-sm text-muted-foreground">{t.session.loading}</p></div>
        </main>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="min-h-screen">
        <CustomerHeader />
        <main className="flex min-h-[70vh] items-center justify-center px-4">
          <Card className="w-full max-w-md">
            <CardHeader><CardTitle>{t.session.notFoundTitle}</CardTitle><CardDescription>{error === SESSION_LOAD_FAILED ? t.session.loadError : error || t.session.notFoundBody}</CardDescription></CardHeader>
            <CardContent><Button asChild className="w-full"><Link href="/">{t.session.bookNew}<ArrowRight /></Link></Button></CardContent>
          </Card>
        </main>
      </div>
    )
  }

  const isLive = session.estado === "en_progreso"
  const hasStarted = Boolean(session.startedAt)
  const hasProducts = session.productos.length > 0
  const hasPaidInitial = session.montoPagadoInicial > 0
  const hasPaidFinal = session.montoPagadoFinal > 0
  const paymentInitial = initialAmount(session.total, session.porcentajeInicial)
  const paymentFinal = finalAmount(session.total, session.porcentajeInicial)
  const paidUpFront = isPaidInFullUpFront(session.porcentajeInicial)
  const country = countryFor(session.cliente.pais)
  const suggestedDeliveryCity = session.deliveryCity || country.cities.find((city) =>
    city.localeCompare(session.cliente.ciudad || "", "es", { sensitivity: "base" }) === 0
  ) || ""
  // `pay` answers with a marker for its own failures and the server's own
  // message otherwise, so the language toggle reaches both.
  const paymentErrorMessage = paymentError in t.session.payErrors
    ? t.session.payErrors[paymentError as keyof typeof t.session.payErrors]
    : paymentError

  async function startInitialPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPaymentError("")
    setPaymentStarting(true)
    const failure = await pay({
      city: String(form.get("city") || ""),
      address: String(form.get("address") || ""),
    })
    if (failure) {
      setPaymentError(failure)
      setPaymentStarting(false)
    }
  }

  if (session.bookingEstado === "pendiente_pago") {
    return (
      <div className="min-h-screen">
        <CustomerHeader status="booking" />
        <main className="flex min-h-[75vh] items-center justify-center px-4 py-10">
          <Card className="w-full max-w-xl text-center">
            <CardHeader><Clock3 className="mx-auto size-10" /><CardTitle>{t.session.confirmingTitle}</CardTitle><CardDescription>{t.session.confirmingBody}</CardDescription></CardHeader>
            <CardContent><Badge variant="secondary">{t.session.confirmingBadge}</Badge></CardContent>
          </Card>
        </main>
      </div>
    )
  }

  if (session.bookingEstado === "cancelada") {
    return (
      <div className="min-h-screen">
        <CustomerHeader status="booking" />
        <main className="flex min-h-[75vh] items-center justify-center px-4 py-10">
          <Card className="w-full max-w-xl text-center">
            <CardHeader><CardTitle>{t.session.expiredTitle}</CardTitle><CardDescription>{t.session.expiredBody}</CardDescription></CardHeader>
            <CardContent><Button asChild className="w-full"><Link href="/">{t.session.pickAnother}<ArrowRight /></Link></Button></CardContent>
          </Card>
        </main>
      </div>
    )
  }

  if (!hasStarted && session.estado === "en_progreso") {
    const scheduledAt = new Date(session.fechaHoraProgramada || session.fechaInicio)
    const difference = scheduledAt.getTime() - now
    const remaining = Math.abs(difference)
    const days = Math.floor(remaining / 86_400_000)
    const hours = Math.floor((remaining % 86_400_000) / 3_600_000)
    const minutes = Math.floor((remaining % 3_600_000) / 60_000)
    const seconds = Math.floor((remaining % 60_000) / 1000)
    const countdown = `${days ? `${days}d ` : ""}${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    const scheduledTimePassed = difference <= 0

    return (
      <div className="min-h-screen">
        <CustomerHeader status="booking" />
        <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
          <div className="space-y-6">
            <header className="space-y-2 text-center">
              <Badge><CheckCircle2 />{t.session.bookedBadge}</Badge>
              <h1 className="text-3xl font-bold tracking-tight">{t.session.scheduledTitle}</h1>
              <p className="text-muted-foreground">{t.session.scheduledBody}</p>
            </header>
            <Card>
              <CardHeader className="text-center"><CardDescription>{scheduledTimePassed ? t.session.waitingForSeller : t.session.startsIn}</CardDescription><CardTitle className="font-mono text-3xl sm:text-4xl">{countdown}</CardTitle></CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-md bg-muted p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.session.appointment}</p><p className="mt-1 font-semibold">{scheduledAt.toLocaleString(dateLocale, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</p></div>
                <div className="rounded-md bg-muted p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.session.outlet}</p><p className="mt-1 font-semibold">{session.outlet || "Nike Sawgrass"}</p><p className="text-sm text-muted-foreground">{t.session.withSeller(session.vendedor.nombre)}</p></div>
                <div className="rounded-md bg-muted p-4 sm:col-span-2"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold">{t.session.bookingPayment}</p><p className="text-sm text-muted-foreground">{t.session.bookingSecured}</p></div><Badge variant="secondary"><CheckCircle2 />{session.bookingFee > 0 ? t.session.feePaid : t.session.referralReward}</Badge></div></div>
                <Button size="lg" className="sm:col-span-2" disabled><WhatsAppIcon />{scheduledTimePassed ? t.session.waitingToStart : t.session.connectWhenStarted}</Button>
                <p className="text-center text-xs text-muted-foreground sm:col-span-2">{t.session.keepOpen}</p>
              </CardContent>
            </Card>
            <PurchaseHistoryCard history={history} locale={locale} />
            <ReferralInviteCard history={history} t={t} />
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <CustomerHeader status={isLive ? "live" : "order"} />

      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t.session.yourOrder}</p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {isLive ? t.session.liveCart : t.session.brashOrder}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{t.session.shoppingWith(session.vendedor.nombre, session.id.slice(-8).toUpperCase())}</p>
          </div>

        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
          <div className="space-y-6">
            {isLive && (
              <Card>
                <CardContent className="flex flex-col justify-between gap-4 py-5 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-muted"><WhatsAppIcon className="size-5" /></span>
                    <div><p className="font-semibold">{t.session.callInProgress}</p><p className="text-sm text-muted-foreground">{t.session.callInProgressBody}</p></div>
                  </div>

                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div><CardTitle className="flex items-center gap-2 text-xl"><ShoppingBag className="size-5" />{t.session.cart}</CardTitle>{!isLive && <CardDescription>{t.session.cartInvoiceNote}</CardDescription>}</div>
                <Badge variant="secondary">{t.session.items(session.productos.length)}</Badge>
              </CardHeader>
              <CardContent>
                {!hasProducts ? (
                  <div className="rounded-md bg-muted py-16 text-center">
                    <Package className="mx-auto mb-3 size-10 text-muted-foreground" />
                    <p className="font-medium">{t.session.cartEmptyTitle}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{t.session.cartEmptyBody}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {session.productos.map((product) => (
                      <article key={product.id} className="flex items-center gap-3 rounded-md bg-muted px-3 py-2.5">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground"><Package className="size-5" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0"><p className="truncate text-sm font-semibold">{product.nombre}</p>{product.sku && <p className="truncate text-[11px] text-muted-foreground">SKU {product.sku}</p>}</div>
                            <p className="shrink-0 text-sm font-bold">{formatCurrency(product.precio * product.cantidad)}</p>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{t.session.qty(product.cantidad)}</Badge>
                            <span>{formatCurrency(product.precio)} {t.session.each}</span>
                            {product.notas && <span className="basis-full text-muted-foreground">{product.notas}</span>}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Truck className="size-5" />{t.session.orderStatus}</CardTitle><CardDescription>{t.session.orderStatusBody}</CardDescription></CardHeader>
              <CardContent>
                <div className="grid gap-0 sm:grid-cols-5">
                  {timeline.map((item, index) => (
                    <div key={item.id} className="relative flex gap-3 pb-6 sm:block sm:pb-0 sm:text-center">
                      {index < timeline.length - 1 && <div className={cn("absolute left-4 top-8 h-[calc(100%-2rem)] w-px sm:left-1/2 sm:top-4 sm:h-px sm:w-full", item.status === "completed" ? "bg-primary" : "bg-border")} />}
                      <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted sm:mx-auto", item.status === "completed" && "bg-primary text-primary-foreground", item.status === "current" && "bg-primary text-primary-foreground", item.status === "pending" && "text-muted-foreground")}>
                        {item.status === "completed" ? <Check className="size-4" /> : item.status === "current" ? <Clock3 className="size-4" /> : <Circle className="size-3" />}
                      </span>
                      <div className="sm:px-2 sm:pt-3"><p className={cn("text-sm font-medium", item.status === "pending" && "text-muted-foreground")}>{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.description}</p></div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {!isLive && <PurchaseHistoryCard history={history} locale={locale} />}
          </div>

          <aside className="space-y-6 lg:sticky lg:top-24">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><ReceiptText className="size-5" />{t.session.invoiceSummary}</CardTitle><CardDescription>{t.session.invoiceNote}</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">{t.session.merchandise}</span><span>{formatCurrency(session.subtotal)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">{t.session.floridaTax(formatPercent(session.tasaImpuesto, dateLocale))}</span><span>{formatCurrency(session.impuesto)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">{t.session.commission(formatPercent(session.tasaComision, dateLocale))}</span><span>{formatCurrency(session.comision)}</span></div>
                <Separator />
                <div className="flex justify-between text-lg font-bold"><span>{t.session.invoiceTotal}</span><span>{formatCurrency(session.total)}</span></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><CreditCard className="size-5" />{t.session.paymentPlan}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md bg-muted p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{t.session.initialPayment}</p><p className="text-xs text-muted-foreground">{paidUpFront ? t.session.paidInFullOnClose : t.session.shareOnClose(formatPercent(session.porcentajeInicial / 100, dateLocale))}</p></div>{hasPaidInitial ? <Badge><CheckCircle2 />{t.session.paid}</Badge> : <Badge variant="secondary">{t.session.pending}</Badge>}</div>
                  <p className="mt-3 text-2xl font-bold">{formatCurrency(paymentInitial)}</p>
                  {!isLive && !hasPaidInitial && <form className="mt-4 space-y-3" onSubmit={startInitialPayment}><div className="space-y-1.5"><Label htmlFor="delivery-city">{t.session.deliveryCity(country.name)}</Label><DeliveryCityCombobox cities={country.cities} defaultValue={suggestedDeliveryCity} /><p className="text-[11px] text-muted-foreground">{t.session.deliveryCityHint(country.adjective[locale])}</p></div><div className="space-y-1.5"><Label htmlFor="delivery-address">{t.session.deliveryAddress}</Label><Textarea className="min-h-20 resize-y" id="delivery-address" name="address" defaultValue={session.deliveryAddress || ""} minLength={8} maxLength={500} rows={3} autoComplete="street-address" placeholder={t.session.deliveryAddressPlaceholder} required /><p className="text-[11px] text-muted-foreground">{t.session.deliveryAddressHint}</p></div><p className="text-[11px] text-muted-foreground">{t.session.addressLockNote}</p>{paymentErrorMessage && <p className="text-sm text-destructive">{paymentErrorMessage}</p>}<Button className="w-full" disabled={!hasProducts || paymentStarting}>{paymentStarting ? t.session.openingPayment : t.session.continueAndPay(formatCurrency(paymentInitial))}</Button></form>}
                </div>
                <div className="rounded-md bg-muted p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{t.session.finalPayment}</p><p className="text-xs text-muted-foreground">{paidUpFront ? t.session.noBalance : t.session.shareOnDelivery(formatPercent(1 - session.porcentajeInicial / 100, dateLocale))}</p></div>{paidUpFront ? <Badge><CheckCircle2 />{t.session.prepaid}</Badge> : hasPaidFinal ? <Badge><CheckCircle2 />{t.session.paid}</Badge> : <Badge variant="secondary">{t.session.onDelivery}</Badge>}</div>
                  <p className="mt-3 text-2xl font-bold">{formatCurrency(paymentFinal)}</p>
                  {hasPaidInitial && !hasPaidFinal && !paidUpFront && <p className="mt-3 text-xs text-muted-foreground">{t.session.finalNote}</p>}{paidUpFront && <p className="mt-3 text-xs text-muted-foreground">{t.session.prepaidNote}</p>}
                </div>
              </CardContent>
            </Card>

            {!isLive && <Card>
              <CardContent className="flex gap-3 py-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10"><MapPin className="size-5" /></span>
                <div><p className="font-medium">{t.session.shippingTo(country.name)}</p><p className="text-sm text-muted-foreground">{session.envio ? t.session.currentStatus(shipmentStatusLabel(session.envio.estado, country.name, t)) : t.session.shippingPending}</p>{session.envio?.labelCode && <p className="mt-2 text-sm"><span className="text-muted-foreground">{t.session.shipmentCode}</span><span className="font-mono font-semibold">{session.envio.labelCode}</span></p>}</div>
              </CardContent>
            </Card>}

            {!isLive && <ReferralInviteCard history={history} t={t} />}
          </aside>
        </div>
      </main>
    </div>
  )
}
