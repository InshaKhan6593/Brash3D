"use client"

import { use, useMemo } from "react"
import Link from "next/link"
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  CreditCard,
  MapPin,
  MessageCircle,
  Package,
  ReceiptText,
  ShoppingBag,
  Truck,
} from "lucide-react"
import { CustomerHeader } from "@/components/customer-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useSession } from "@/lib/hooks/useSession"
import { cn, formatCurrency } from "@/lib/utils"

interface TimelineItem {
  id: string
  title: string
  description: string
  status: "completed" | "current" | "pending"
}

export default function CustomerSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { session, loading, error, pay } = useSession(id)

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!session) return []

    const closed = session.estado === "completada"
    const paidInitial = session.montoPagado65 > 0
    const paidFinal = session.montoPagado35 > 0

    return [
      { id: "booked", title: "Booking confirmed", description: "Your Brash3D appointment is reserved", status: "completed" },
      { id: "shopping", title: "Live shopping", description: closed ? "Your seller completed the shopping session" : "Your seller is adding products now", status: closed ? "completed" : "current" },
      { id: "initial", title: "Initial payment", description: paidInitial ? `${formatCurrency(session.montoPagado65)} received` : "65% is due after the session closes", status: paidInitial ? "completed" : closed ? "current" : "pending" },
      { id: "shipping", title: "Shipping to Colombia", description: "Tracking appears here after dispatch", status: paidInitial ? "current" : "pending" },
      { id: "delivery", title: "Delivery and final payment", description: paidFinal ? "Order delivered and paid" : "35% is collected on delivery", status: paidFinal ? "completed" : "pending" },
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
            <CardHeader><CardTitle>Session not found</CardTitle><CardDescription>{error || "This link is invalid or the demo server was restarted."}</CardDescription></CardHeader>
            <CardContent><Button asChild className="w-full"><Link href="/">Book a new session<ArrowRight /></Link></Button></CardContent>
          </Card>
        </main>
      </div>
    )
  }

  const isLive = session.estado === "en_progreso"
  const hasProducts = session.productos.length > 0
  const hasPaid65 = session.montoPagado65 > 0
  const payment65 = session.total * 0.65
  const payment35 = session.total * 0.35

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
          {isLive && <Button variant="outline" disabled><MessageCircle />WhatsApp call active</Button>}
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
          <div className="space-y-6">
            {isLive && (
              <Card>
                <CardContent className="flex flex-col justify-between gap-4 py-5 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-muted"><MessageCircle /></span>
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
                  <div className="space-y-3">
                    {session.productos.map((product, index) => (
                      <article key={product.id} className="flex gap-4 rounded-md bg-muted p-4 sm:p-5">
                        <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Package className="size-6" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div><p className="font-semibold">{product.nombre}</p><p className="text-xs text-muted-foreground">Item {index + 1}{product.sku ? ` · SKU ${product.sku}` : ""}</p></div>
                            <p className="shrink-0 font-bold">{formatCurrency(product.precio * product.cantidad)}</p>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline">Qty {product.cantidad}</Badge>
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
                  {!isLive && !hasPaid65 && <Button className="mt-3 w-full" onClick={() => void pay("65")} disabled={!hasProducts}>Pay 65% now</Button>}
                </div>
                <div className="rounded-md bg-muted p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-medium">Final payment</p><p className="text-xs text-muted-foreground">35% when delivered</p></div><Badge variant="secondary">On delivery</Badge></div>
                  <p className="mt-3 text-2xl font-bold">{formatCurrency(payment35)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex gap-3 py-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10"><MapPin className="size-5" /></span>
                <div><p className="font-medium">Shipping to Colombia</p><p className="text-sm text-muted-foreground">Tracking details will appear after your initial payment is confirmed.</p></div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  )
}
