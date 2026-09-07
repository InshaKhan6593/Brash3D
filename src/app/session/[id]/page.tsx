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
import { ColombiaCityCombobox } from "@/components/colombia-city-combobox"
import { Separator } from "@/components/ui/separator"
import { useSession } from "@/lib/hooks/useSession"
import { COLOMBIA_CITIES } from "@/lib/colombia-cities"
import { CustomerPurchaseHistory } from "@/lib/types"
import { cn, formatCurrency } from "@/lib/utils"

interface TimelineItem {
  id: string
  title: string
  description: string
  status: "completed" | "current" | "pending"
}

function PurchaseHistoryCard({ history }: { history: CustomerPurchaseHistory | null }) {
  if (!history) return null

  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><ReceiptText className="size-5" />Purchase history</CardTitle><CardDescription>Your completed Brash3D shopping sessions.</CardDescription></CardHeader>
    <CardContent>
      {history.purchases.length === 0 ? <p className="text-sm text-muted-foreground">Your completed orders will appear here after your first live-shopping session.</p> : <div className="space-y-3">{history.purchases.map((purchase) => <article key={purchase.sessionId} className="rounded-lg border p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{purchase.outlet || "Brash3D live shopping"}</p><p className="text-xs text-muted-foreground">{new Date(purchase.bookedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p></div><p className="font-semibold">{formatCurrency(purchase.total)}</p></div><p className="mt-2 text-sm text-muted-foreground">{purchase.products.map((product) => `${product.nombre} × ${product.cantidad}`).join(", ") || "No product details recorded"}</p></article>)}</div>}
    </CardContent>
  </Card>
}

function ReferralInviteCard({ history }: { history: CustomerPurchaseHistory | null }) {
  if (!history) return null

  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Copy className="size-5" />Invite a friend</CardTitle><CardDescription>Share your code. You earn a free booking after their first paid shopping session.</CardDescription></CardHeader>
    <CardContent className="space-y-3"><code className="block rounded-md bg-muted px-3 py-2 text-center text-base font-semibold tracking-wide">{history.customer.referralCode}</code>{history.availableReferralRewards > 0 ? <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{history.availableReferralRewards} free booking {history.availableReferralRewards === 1 ? "is" : "are"} ready to use ({formatCurrency(history.availableReferralCredit)} credit).</p> : <p className="text-sm text-muted-foreground">Your next available reward will automatically cover the $20 booking fee.</p>}</CardContent>
  </Card>
}

export default function CustomerSessionPage({ params }: PageProps<"/session/[id]">) {
  const { id } = use(params)
  const { session, loading, error, pay } = useSession(id)
  const [now, setNow] = useState(() => Date.now())
  const [paymentError, setPaymentError] = useState("")
  const [paymentStarting, setPaymentStarting] = useState(false)
  const [history, setHistory] = useState<CustomerPurchaseHistory | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    async function loadHistory() {
      const response = await fetch(`/api/customer-history?sessionId=${encodeURIComponent(id)}`, { cache: "no-store" })
      if (!response.ok) return
      const data = await response.json() as { history: CustomerPurchaseHistory }
      setHistory(data.history)
    }
    void loadHistory()
  }, [id])

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!session) return []

    const closed = session.estado === "completada"
    const paidInitial = session.montoPagado65 > 0
    const paidFinal = session.montoPagado35 > 0
    const shipment = session.envio
    const shipped = shipment && shipment.estado !== "preparacion"
    const delivered = shipment?.estado === "entregado"

    return [
      { id: "booked", title: "Booking confirmed", description: "Your Brash3D appointment is reserved", status: "completed" },
      { id: "shopping", title: "Live shopping", description: closed ? "Your seller completed the shopping session" : "Your seller is adding products now", status: closed ? "completed" : "current" },
      { id: "initial", title: "Initial payment", description: paidInitial ? `${formatCurrency(session.montoPagado65)} received` : "65% is due after the session closes", status: paidInitial ? "completed" : closed ? "current" : "pending" },
      { id: "shipping", title: "Shipping to Colombia", description: shipped ? "Your shipment status is being updated by Brash3D" : "Staff prepares shipping after the 65% payment", status: delivered ? "completed" : paidInitial ? "current" : "pending" },
      { id: "delivery", title: "Delivery and final payment", description: paidFinal ? "Order delivered and paid" : delivered ? "Delivery confirmed; staff is processing the remaining 35%" : "35% is collected when delivery is confirmed", status: paidFinal ? "completed" : delivered ? "current" : "pending" },
    ]
  }, [session])

  if (loading) {
    return (
      <div className="min-h-screen">
        <CustomerHeader />
        <main className="flex min-h-[70vh] items-center justify-center">
          <div className="text-center"><div className="mx-auto mb-3 size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /><p className="text-sm text-muted-foreground">Loading your order...</p></div>
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
            <CardHeader><CardTitle>Session not found</CardTitle><CardDescription>{error || "This secure link is invalid, expired, or has been replaced."}</CardDescription></CardHeader>
            <CardContent><Button asChild className="w-full"><Link href="/">Book a new session<ArrowRight /></Link></Button></CardContent>
          </Card>
        </main>
      </div>
    )
  }

  const isLive = session.estado === "en_progreso"
  const hasStarted = Boolean(session.startedAt)
  const hasProducts = session.productos.length > 0
  const hasPaid65 = session.montoPagado65 > 0
  const hasPaid35 = session.montoPagado35 > 0
  const payment65 = session.total * 0.65
  const payment35 = session.total * 0.35
  const suggestedDeliveryCity = session.deliveryCity || COLOMBIA_CITIES.find((city) =>
    city.localeCompare(session.cliente.ciudad || "", "es", { sensitivity: "base" }) === 0
  ) || ""

  async function startInitialPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPaymentError("")
    setPaymentStarting(true)
    const started = await pay("65", {
      city: String(form.get("city") || ""),
      address: String(form.get("address") || ""),
    })
    if (!started) {
      setPaymentError("Check the delivery address and try again.")
      setPaymentStarting(false)
    }
  }

  if (session.bookingEstado === "pendiente_pago") {
    return (
      <div className="min-h-screen">
        <CustomerHeader status="booking" />
        <main className="flex min-h-[75vh] items-center justify-center px-4 py-10">
          <Card className="w-full max-w-xl text-center">
            <CardHeader><Clock3 className="mx-auto size-10" /><CardTitle>Payment is being confirmed</CardTitle><CardDescription>Stripe is processing your $20 booking payment. This page updates automatically.</CardDescription></CardHeader>
            <CardContent><Badge variant="secondary">Processing securely</Badge></CardContent>
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
            <CardHeader><CardTitle>Reservation expired</CardTitle><CardDescription>This appointment is no longer reserved. Please choose another available time.</CardDescription></CardHeader>
            <CardContent><Button asChild className="w-full"><Link href="/">Choose another time<ArrowRight /></Link></Button></CardContent>
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
              <Badge><CheckCircle2 />Booking confirmed</Badge>
              <h1 className="text-3xl font-bold tracking-tight">Your live shopping session is scheduled</h1>
              <p className="text-muted-foreground">Your personal shopper will start the WhatsApp call at the appointment time.</p>
            </header>
            <Card>
              <CardHeader className="text-center"><CardDescription>{scheduledTimePassed ? "Waiting for your shopper · scheduled time passed by" : "Session starts in"}</CardDescription><CardTitle className="font-mono text-3xl sm:text-4xl">{countdown}</CardTitle></CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-md bg-muted p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Appointment</p><p className="mt-1 font-semibold">{scheduledAt.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</p></div>
                <div className="rounded-md bg-muted p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Outlet</p><p className="mt-1 font-semibold">{session.outlet || "Nike Sawgrass"}</p><p className="text-sm text-muted-foreground">With {session.vendedor.nombre}</p></div>
                <div className="rounded-md bg-muted p-4 sm:col-span-2"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold">Booking payment</p><p className="text-sm text-muted-foreground">Your appointment is secured.</p></div><Badge variant="secondary"><CheckCircle2 />{session.bookingFee > 0 ? "$20 paid" : "Referral reward"}</Badge></div></div>
                <Button size="lg" className="sm:col-span-2" disabled><WhatsAppIcon />{scheduledTimePassed ? "Waiting for your shopper to start" : "Join session when your shopper starts it"}</Button>
                <p className="text-center text-xs text-muted-foreground sm:col-span-2">Keep this page open. It will switch to your live cart automatically.</p>
              </CardContent>
            </Card>
            <PurchaseHistoryCard history={history} />
            <ReferralInviteCard history={history} />
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
            <p className="text-sm font-medium text-muted-foreground">Customer order</p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {isLive ? "Your live shopping cart" : "Your Brash3D order"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Shopping with {session.vendedor.nombre} · Order {session.id.slice(-8).toUpperCase()}</p>
          </div>
          {isLive && <Button variant="outline" disabled><WhatsAppIcon />WhatsApp call active</Button>}
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
          <div className="space-y-6">
            {isLive && (
              <Card>
                <CardContent className="flex flex-col justify-between gap-4 py-5 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-muted"><WhatsAppIcon className="size-5" /></span>
                    <div><p className="font-semibold">Live call in progress</p><p className="text-sm text-muted-foreground">Products update automatically while you shop.</p></div>
                  </div>
                  <Badge className="w-fit">Connected</Badge>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div><CardTitle className="flex items-center gap-2 text-xl"><ShoppingBag className="size-5" />Shopping cart</CardTitle><CardDescription>{isLive ? "New items appear here without refreshing." : "These items are included in your invoice."}</CardDescription></div>
                <Badge variant="secondary">{session.productos.length} {session.productos.length === 1 ? "item" : "items"}</Badge>
              </CardHeader>
              <CardContent>
                {!hasProducts ? (
                  <div className="rounded-md bg-muted py-16 text-center">
                    <Package className="mx-auto mb-3 size-10 text-muted-foreground" />
                    <p className="font-medium">Your cart is ready</p>
                    <p className="mt-1 text-sm text-muted-foreground">Your personal shopper will add products during the call.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {session.productos.map((product, index) => (
                      <article key={product.id} className="flex items-center gap-3 rounded-md bg-muted px-3 py-2.5">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground"><Package className="size-5" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0"><p className="truncate text-sm font-semibold">{product.nombre}</p><p className="text-[11px] text-muted-foreground">Item {index + 1}</p></div>
                            <p className="shrink-0 text-sm font-bold">{formatCurrency(product.precio * product.cantidad)}</p>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Qty {product.cantidad}</Badge>
                            <span>{formatCurrency(product.precio)} each</span>
                            {product.notas && <><span>·</span><span>{product.notas}</span></>}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Truck className="size-5" />Order progress</CardTitle><CardDescription>Follow your purchase from booking through delivery.</CardDescription></CardHeader>
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

            <PurchaseHistoryCard history={history} />
          </div>

          <aside className="space-y-6 lg:sticky lg:top-24">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><ReceiptText className="size-5" />Order summary</CardTitle><CardDescription>All prices are shown in USD.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Merchandise subtotal</span><span>{formatCurrency(session.subtotal)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Florida tax 7%</span><span>{formatCurrency(session.impuesto)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Brash3D service 15%</span><span>{formatCurrency(session.comision)}</span></div>
                <Separator />
                <div className="flex justify-between text-lg font-bold"><span>Total</span><span>{formatCurrency(session.total)}</span></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><CreditCard className="size-5" />Payment plan</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md bg-muted p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-medium">Initial payment</p><p className="text-xs text-muted-foreground">65% after live shopping</p></div>{hasPaid65 ? <Badge><CheckCircle2 />Paid</Badge> : <Badge variant="secondary">Pending</Badge>}</div>
                  <p className="mt-3 text-2xl font-bold">{formatCurrency(payment65)}</p>
                  {!isLive && !hasPaid65 && <form className="mt-4 space-y-3" onSubmit={startInitialPayment}><div className="space-y-1.5"><Label htmlFor="delivery-city">Delivery city in Colombia</Label><ColombiaCityCombobox defaultValue={suggestedDeliveryCity} /><p className="text-[11px] text-muted-foreground">Search the list or type another Colombian municipality.</p></div><div className="space-y-1.5"><Label htmlFor="delivery-address">Complete delivery address</Label><Textarea className="min-h-20 resize-y" id="delivery-address" name="address" defaultValue={session.deliveryAddress || ""} minLength={8} maxLength={500} rows={3} autoComplete="street-address" placeholder="Street, number, apartment, neighborhood, and delivery note" required /><p className="text-[11px] text-muted-foreground">Include apartment, neighborhood, and a landmark when needed.</p></div><p className="text-[11px] text-muted-foreground">The seller can view this confirmed address but cannot change it.</p>{paymentError && <p className="text-sm text-destructive">{paymentError}</p>}<Button className="w-full" disabled={!hasProducts || paymentStarting}>{paymentStarting ? "Opening secure payment..." : "Continue to pay 65%"}</Button></form>}
                </div>
                <div className="rounded-md bg-muted p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-medium">Final payment</p><p className="text-xs text-muted-foreground">35% when delivered</p></div>{hasPaid35 ? <Badge><CheckCircle2 />Paid</Badge> : <Badge variant="secondary">On delivery</Badge>}</div>
                  <p className="mt-3 text-2xl font-bold">{formatCurrency(payment35)}</p>
                  {hasPaid65 && !hasPaid35 && <p className="mt-3 text-xs text-muted-foreground">Brash3D staff updates delivery and initiates the remaining payment. No customer completion action is required here.</p>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex gap-3 py-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10"><MapPin className="size-5" /></span>
                <div><p className="font-medium">Shipping to Colombia</p><p className="text-sm text-muted-foreground">{session.envio ? `Current status: ${session.envio.estado.replaceAll("_", " ")}.` : "Tracking details will appear after your initial payment is confirmed and staff creates the shipment."}</p>{session.envio?.labelCode && <p className="mt-2 text-sm"><span className="text-muted-foreground">Shipment code: </span><span className="font-mono font-semibold">{session.envio.labelCode}</span></p>}</div>
              </CardContent>
            </Card>

            <ReferralInviteCard history={history} />
          </aside>
        </div>
      </main>
    </div>
  )
}
