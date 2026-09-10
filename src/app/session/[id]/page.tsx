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
import { PurchaseHistoryTable } from "@/components/purchase-history-table"
import { useSession } from "@/lib/hooks/useSession"
import { COLOMBIA_CITIES } from "@/lib/colombia-cities"
import { CustomerPurchaseHistory, EnvioEstado } from "@/lib/types"
import { finalAmount, initialAmount, isPaidInFullUpFront } from "@/lib/payment-split"
import { cn, formatCurrency, formatPercent } from "@/lib/utils"

const SHIPMENT_STATUS_ES: Record<EnvioEstado, string> = {
  preparacion: "en preparación",
  en_transito: "en tránsito a Colombia",
  en_aduanas: "en aduanas",
  recibido_equipo_local: "recibido por el equipo en Colombia",
  entregado: "entregado",
  devuelto: "devuelto",
}

function shipmentStatusLabel(estado: EnvioEstado): string {
  return SHIPMENT_STATUS_ES[estado]
}

interface TimelineItem {
  id: string
  title: string
  description: string
  status: "completed" | "current" | "pending"
}

function PurchaseHistoryCard({ history }: { history: CustomerPurchaseHistory | null }) {
  if (!history) return null
  return <PurchaseHistoryTable history={history} locale="es" />
}

function ReferralInviteCard({ history }: { history: CustomerPurchaseHistory | null }) {
  const [copied, setCopied] = useState(false)

  if (!history) return null
  const code = history.customer.referralCode

  // Sharing the code is the whole point of this card, so it needs a real button
  // rather than an icon; selecting text by hand on a phone is painful.
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return <Card>
    <CardHeader>
      <CardTitle className="text-xl">Invita a un amigo</CardTitle>
      <CardDescription>Comparte tu código. Ganas una reserva gratis cuando esa persona complete su primera sesión pagada.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-center text-base font-semibold tracking-wide">{code}</code>
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void copyCode()} aria-label="Copiar código de referido">
          {copied ? <><Check />Copiado</> : <><Copy />Copiar</>}
        </Button>
      </div>
      {history.availableReferralRewards > 0
        ? <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{history.availableReferralRewards} reserva{history.availableReferralRewards === 1 ? "" : "s"} gratis disponible{history.availableReferralRewards === 1 ? "" : "s"} ({formatCurrency(history.availableReferralCredit)} en crédito).</p>
        : <p className="text-sm text-muted-foreground">Tu próxima recompensa cubrirá automáticamente los 20 USD de la reserva.</p>}
    </CardContent>
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
    const paidInitial = session.montoPagadoInicial > 0
    const paidFinal = session.montoPagadoFinal > 0
    const shipment = session.envio
    const shipped = shipment && shipment.estado !== "preparacion"
    const delivered = shipment?.estado === "entregado"

    return [
      { id: "booked", title: "Reserva confirmada", description: "Tu cita con Brash3D está apartada", status: "completed" },
      { id: "shopping", title: "Compra en vivo", description: closed ? "Tu comprador personal cerró la sesión" : "Tu comprador personal está agregando productos", status: closed ? "completed" : "current" },
      { id: "initial", title: "Pago inicial", description: paidInitial ? `${formatCurrency(session.montoPagadoInicial)} recibidos` : "Se paga al cerrar la sesión", status: paidInitial ? "completed" : closed ? "current" : "pending" },
      { id: "shipping", title: "En camino a Colombia", description: shipped ? "Brash3D está actualizando el estado de tu envío" : "El envío se prepara después del pago inicial", status: delivered ? "completed" : paidInitial ? "current" : "pending" },
      { id: "delivery", title: "Entrega y pago final", description: paidFinal ? "Pedido entregado y pagado" : delivered ? "Entrega confirmada" : session.porcentajeInicial >= 100 ? "Ya pagaste el total; solo falta recibir" : "El saldo se cobra al confirmar la entrega", status: paidFinal ? "completed" : delivered ? "current" : "pending" },
    ]
  }, [session])

  if (loading) {
    return (
      <div className="min-h-screen">
        <CustomerHeader />
        <main className="flex min-h-[70vh] items-center justify-center">
          <div className="text-center"><div className="mx-auto mb-3 size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /><p className="text-sm text-muted-foreground">Cargando tu pedido...</p></div>
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
            <CardHeader><CardTitle>Sesión no encontrada</CardTitle><CardDescription>{error || "Este enlace seguro no es válido, expiró o fue reemplazado."}</CardDescription></CardHeader>
            <CardContent><Button asChild className="w-full"><Link href="/">Reservar una nueva sesión<ArrowRight /></Link></Button></CardContent>
          </Card>
        </main>
      </div>
    )
  }

  const isLive = session.estado === "en_progreso"
  const hasStarted = Boolean(session.startedAt)
  const hasProducts = session.productos.length > 0
  const hasPaid65 = session.montoPagadoInicial > 0
  const hasPaid35 = session.montoPagadoFinal > 0
  const paymentInitial = initialAmount(session.total, session.porcentajeInicial)
  const paymentFinal = finalAmount(session.total, session.porcentajeInicial)
  const paidUpFront = isPaidInFullUpFront(session.porcentajeInicial)
  const suggestedDeliveryCity = session.deliveryCity || COLOMBIA_CITIES.find((city) =>
    city.localeCompare(session.cliente.ciudad || "", "es", { sensitivity: "base" }) === 0
  ) || ""

  async function startInitialPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPaymentError("")
    setPaymentStarting(true)
    const started = await pay({
      city: String(form.get("city") || ""),
      address: String(form.get("address") || ""),
    })
    if (!started) {
      setPaymentError("Revisa la dirección de entrega e inténtalo de nuevo.")
      setPaymentStarting(false)
    }
  }

  if (session.bookingEstado === "pendiente_pago") {
    return (
      <div className="min-h-screen">
        <CustomerHeader status="booking" />
        <main className="flex min-h-[75vh] items-center justify-center px-4 py-10">
          <Card className="w-full max-w-xl text-center">
            <CardHeader><Clock3 className="mx-auto size-10" /><CardTitle>Estamos confirmando tu pago</CardTitle><CardDescription>Stripe está procesando los 20 USD de tu reserva. Esta página se actualiza sola.</CardDescription></CardHeader>
            <CardContent><Badge variant="secondary">Procesando de forma segura</Badge></CardContent>
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
            <CardHeader><CardTitle>La reserva expiró</CardTitle><CardDescription>Esta cita ya no está apartada. Elige otro horario disponible.</CardDescription></CardHeader>
            <CardContent><Button asChild className="w-full"><Link href="/">Elegir otro horario<ArrowRight /></Link></Button></CardContent>
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
              <Badge><CheckCircle2 />Reserva confirmada</Badge>
              <h1 className="text-3xl font-bold tracking-tight">Tu sesión de compra en vivo está agendada</h1>
              <p className="text-muted-foreground">Tu comprador personal iniciará la videollamada de WhatsApp a la hora de la cita.</p>
            </header>
            <Card>
              <CardHeader className="text-center"><CardDescription>{scheduledTimePassed ? "Esperando a tu comprador personal · la hora agendada ya pasó" : "La sesión empieza en"}</CardDescription><CardTitle className="font-mono text-3xl sm:text-4xl">{countdown}</CardTitle></CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-md bg-muted p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cita</p><p className="mt-1 font-semibold">{scheduledAt.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</p></div>
                <div className="rounded-md bg-muted p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Outlet</p><p className="mt-1 font-semibold">{session.outlet || "Nike Sawgrass"}</p><p className="text-sm text-muted-foreground">Con {session.vendedor.nombre}</p></div>
                <div className="rounded-md bg-muted p-4 sm:col-span-2"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold">Pago de la reserva</p><p className="text-sm text-muted-foreground">Tu cita está asegurada.</p></div><Badge variant="secondary"><CheckCircle2 />{session.bookingFee > 0 ? "20 USD pagados" : "Recompensa de referido"}</Badge></div></div>
                <Button size="lg" className="sm:col-span-2" disabled><WhatsAppIcon />{scheduledTimePassed ? "Esperando a que tu comprador inicie" : "Te conectas cuando tu comprador inicie la sesión"}</Button>
                <p className="text-center text-xs text-muted-foreground sm:col-span-2">Deja esta página abierta. Cambiará a tu carrito en vivo automáticamente.</p>
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
            <p className="text-sm font-medium text-muted-foreground">Tu pedido</p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {isLive ? "Tu carrito en vivo" : "Tu pedido Brash3D"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Comprando con {session.vendedor.nombre} · Pedido {session.id.slice(-8).toUpperCase()}</p>
          </div>
          
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
          <div className="space-y-6">
            {isLive && (
              <Card>
                <CardContent className="flex flex-col justify-between gap-4 py-5 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-muted"><WhatsAppIcon className="size-5" /></span>
                    <div><p className="font-semibold">Videollamada en curso</p><p className="text-sm text-muted-foreground">Los productos se actualizan solos mientras compras.</p></div>
                  </div>
                  
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div><CardTitle className="flex items-center gap-2 text-xl"><ShoppingBag className="size-5" />Carrito de compras</CardTitle>{!isLive && <CardDescription>Estos productos están incluidos en tu factura.</CardDescription>}</div>
                <Badge variant="secondary">{session.productos.length} {session.productos.length === 1 ? "producto" : "productos"}</Badge>
              </CardHeader>
              <CardContent>
                {!hasProducts ? (
                  <div className="rounded-md bg-muted py-16 text-center">
                    <Package className="mx-auto mb-3 size-10 text-muted-foreground" />
                    <p className="font-medium">Tu carrito está listo</p>
                    <p className="mt-1 text-sm text-muted-foreground">Tu comprador personal agregará productos durante la llamada.</p>
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
                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Cant. {product.cantidad}</Badge>
                            <span>{formatCurrency(product.precio)} c/u</span>
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
              <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Truck className="size-5" />Estado de tu pedido</CardTitle><CardDescription>Sigue tu compra desde la reserva hasta la entrega.</CardDescription></CardHeader>
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

            {!isLive && <PurchaseHistoryCard history={history} />}
          </div>

          <aside className="space-y-6 lg:sticky lg:top-24">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><ReceiptText className="size-5" />Resumen de la factura</CardTitle><CardDescription>Todos los precios están en dólares (USD).</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal de mercancía</span><span>{formatCurrency(session.subtotal)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Impuesto Florida ({formatPercent(session.tasaImpuesto)})</span><span>{formatCurrency(session.impuesto)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Comisión Brash3D ({formatPercent(session.tasaComision)})</span><span>{formatCurrency(session.comision)}</span></div>
                <Separator />
                <div className="flex justify-between text-lg font-bold"><span>Total factura</span><span>{formatCurrency(session.total)}</span></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><CreditCard className="size-5" />Plan de pago</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md bg-muted p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-medium">Pago inicial</p><p className="text-xs text-muted-foreground">{paidUpFront ? "Pago completo al cerrar la sesión" : `${formatPercent(session.porcentajeInicial / 100)} al cerrar la sesión`}</p></div>{hasPaid65 ? <Badge><CheckCircle2 />Pagado</Badge> : <Badge variant="secondary">Pendiente</Badge>}</div>
                  <p className="mt-3 text-2xl font-bold">{formatCurrency(paymentInitial)}</p>
                  {!isLive && !hasPaid65 && <form className="mt-4 space-y-3" onSubmit={startInitialPayment}><div className="space-y-1.5"><Label htmlFor="delivery-city">Ciudad de entrega en Colombia</Label><ColombiaCityCombobox defaultValue={suggestedDeliveryCity} /><p className="text-[11px] text-muted-foreground">Busca en la lista o escribe otro municipio colombiano.</p></div><div className="space-y-1.5"><Label htmlFor="delivery-address">Dirección completa de entrega</Label><Textarea className="min-h-20 resize-y" id="delivery-address" name="address" defaultValue={session.deliveryAddress || ""} minLength={8} maxLength={500} rows={3} autoComplete="street-address" placeholder="Calle, número, apartamento, barrio y nota de entrega" required /><p className="text-[11px] text-muted-foreground">Incluye apartamento, barrio y un punto de referencia si hace falta.</p></div><p className="text-[11px] text-muted-foreground">El vendedor puede ver esta dirección confirmada pero no puede cambiarla.</p>{paymentError && <p className="text-sm text-destructive">{paymentError}</p>}<Button className="w-full" disabled={!hasProducts || paymentStarting}>{paymentStarting ? "Abriendo pago seguro..." : `Continuar y pagar ${formatCurrency(paymentInitial)}`}</Button></form>}
                </div>
                <div className="rounded-md bg-muted p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-medium">Pago final</p><p className="text-xs text-muted-foreground">{paidUpFront ? "Sin saldo pendiente" : `${formatPercent(1 - session.porcentajeInicial / 100)} contra entrega`}</p></div>{paidUpFront ? <Badge><CheckCircle2 />Pagado por adelantado</Badge> : hasPaid35 ? <Badge><CheckCircle2 />Pagado</Badge> : <Badge variant="secondary">Contra entrega</Badge>}</div>
                  <p className="mt-3 text-2xl font-bold">{formatCurrency(paymentFinal)}</p>
                  {hasPaid65 && !hasPaid35 && !paidUpFront && <p className="mt-3 text-xs text-muted-foreground">El equipo Brash3D confirma la entrega e inicia el pago restante. No necesitas hacer nada más desde aquí.</p>}{paidUpFront && <p className="mt-3 text-xs text-muted-foreground">Ya pagaste el total de tu pedido. Solo tienes que recibir los productos.</p>}
                </div>
              </CardContent>
            </Card>

            {!isLive && <Card>
              <CardContent className="flex gap-3 py-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10"><MapPin className="size-5" /></span>
                <div><p className="font-medium">Envío a Colombia</p><p className="text-sm text-muted-foreground">{session.envio ? `Estado actual: ${shipmentStatusLabel(session.envio.estado)}.` : "Los datos de seguimiento aparecen cuando se confirme tu pago inicial y el equipo cree el envío."}</p>{session.envio?.labelCode && <p className="mt-2 text-sm"><span className="text-muted-foreground">Código de envío: </span><span className="font-mono font-semibold">{session.envio.labelCode}</span></p>}</div>
              </CardContent>
            </Card>}

            {!isLive && <ReferralInviteCard history={history} />}
          </aside>
        </div>
      </main>
    </div>
  )
}
