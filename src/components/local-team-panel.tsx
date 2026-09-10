"use client"

import { useCallback, useEffect, useState } from "react"
import { Banknote, CheckCircle2, Clipboard, CreditCard, FileText, Landmark, LogOut, MoreHorizontal, PackageCheck, Phone, Wallet } from "lucide-react"
import { useRouter } from "next/navigation"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ModeToggle } from "@/components/mode-toggle"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { BoxSettlement, ConsolidatedBoxManifest, SesionCompra } from "@/lib/types"
import { outstandingBalance } from "@/lib/payment-split"
import { formatCurrency, formatDateTimeEs } from "@/lib/utils"

type OperationsView = "incoming" | "received" | "deliveries"
type DeliveryFilter = "all" | "awaiting_payment" | "ready_for_handover" | "delivered"

const deliveryFilters: Array<{ value: DeliveryFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "awaiting_payment", label: "Pago pendiente" },
  { value: "ready_for_handover", label: "Listas para entregar" },
  { value: "delivered", label: "Entregadas" },
]

function balanceFor(session: SesionCompra): number {
  return outstandingBalance(session.total, session.porcentajeInicial, session.montoPagadoFinal)
}

function deliveryFilterFor(session: SesionCompra): DeliveryFilter {
  if (session.envio?.estado === "entregado") return "delivered"
  // A customer who paid in full up front owes nothing, so the package is ready
  // to hand over as soon as the box arrives.
  if (session.montoPagadoFinal > 0 || balanceFor(session) === 0) return "ready_for_handover"
  return "awaiting_payment"
}

function deliveryStatusLabel(session: SesionCompra): string {
  if (session.envio?.estado === "entregado") return "Entregado"
  if (session.montoPagadoFinal > 0 || balanceFor(session) === 0) return "Listo para entregar"
  return "Pago pendiente"
}

function paymentMethodLabel(session: SesionCompra): string | null {
  if (session.montoPagadoFinal <= 0 && balanceFor(session) === 0) return "Pagado por adelantado"
  if (session.montoPagadoFinal <= 0) return null
  if (session.envio?.metodoPagoRecibido === "stripe") return "Cobrado por Stripe"
  if (session.envio?.metodoPagoRecibido === "efectivo") return "Cobrado en efectivo"
  if (session.envio?.metodoPagoRecibido === "transferencia") return "Cobrado por transferencia"
  return "Pago recibido"
}

// The team delivers in person, so a one-tap WhatsApp link matters more than the
// raw number. Everything else in this business already runs over WhatsApp.
function whatsappLink(phone: string): string {
  return `https://wa.me/${phone.replace(/[^0-9]/g, "")}`
}

function balanceLabel(amount: number): string {
  return amount > 0 ? `Saldo ${formatCurrency(amount)}` : "Pagado completo"
}

function boxStatusLabel(status: string): string {
  return status === "enviada" ? "En tránsito" : "Recibida"
}

// Section 13 of the specification: Stripe collections are US LLC revenue, cash
// and transfers stay in Colombia as the local team's operating fund. This is
// accounting metadata only — the system never moves money between entities.
function BoxSettlementSummary({ settlement }: { settlement: BoxSettlement }) {
  const rows = [
    {
      key: "stripe",
      icon: CreditCard,
      label: "vía Stripe",
      hint: "ingreso LLC EE.UU.",
      amount: settlement.viaStripe,
      emphasis: false,
    },
    {
      key: "local",
      icon: Wallet,
      label: "fondo local Colombia",
      hint: settlement.transfer > 0
        ? `${formatCurrency(settlement.cash)} efectivo · ${formatCurrency(settlement.transfer)} transferencia`
        : "efectivo recibido por el equipo",
      amount: settlement.localFund,
      emphasis: true,
    },
  ]

  return (
    <section className="rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">Resumen de esta caja</h4>
          <p className="text-xs text-muted-foreground">
            {settlement.deliveredCount} de {settlement.deliveredCount + settlement.pendingCount} entregas cobradas
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">total cobrado en entregas</p>
          <p className="text-2xl font-bold tabular-nums">{formatCurrency(settlement.collected)}</p>
        </div>
      </div>

      <Separator className="my-3" />

      <dl className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-start justify-between gap-3">
            <dt className="flex min-w-0 items-start gap-2">
              <row.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className={row.emphasis ? "block text-sm font-semibold" : "block text-sm"}>{row.label}</span>
                <span className="block text-xs text-muted-foreground">{row.hint}</span>
              </span>
            </dt>
            <dd className={row.emphasis ? "shrink-0 text-sm font-bold tabular-nums" : "shrink-0 text-sm tabular-nums"}>
              {formatCurrency(row.amount)}
            </dd>
          </div>
        ))}
      </dl>

      {settlement.pending > 0 && (
        <>
          <Separator className="my-3" />
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Banknote className="size-4" />
              saldo pendiente por cobrar
            </span>
            <span className="tabular-nums font-medium">{formatCurrency(settlement.pending)}</span>
          </div>
        </>
      )}

      <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
        Cifras contables únicamente. El sistema no transfiere dinero entre Brash3D Media Group LLC y Brash3D SAS.
      </p>
    </section>
  )
}

function ReceiveBoxDialog({ boxNumber, onConfirm }: { boxNumber: string; onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function confirm() {
    setSaving(true)
    setError("")
    try {
      await onConfirm()
      setOpen(false)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo marcar la caja como recibida")
    } finally {
      setSaving(false)
    }
  }

  return <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setError("") }}>
    <DialogTrigger asChild><Button size="sm">Confirmar recepción</Button></DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>¿Marcar {boxNumber} como recibida?</DialogTitle><DialogDescription>Confirma que la caja consolidada llegó físicamente a Colombia. Sus paquetes pasarán a la fila de entregas locales.</DialogDescription></DialogHeader>
      <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">Revisa las etiquetas y el número de paquetes antes de confirmar la recepción.</div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button><Button type="button" onClick={() => void confirm()} disabled={saving}>{saving ? "Confirmando…" : "Sí, caja recibida"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function BoxDetails({ box, onReceive }: { box: ConsolidatedBoxManifest; onReceive?: () => Promise<void> }) {
  return <details className="group border-b last:border-b-0">
    <summary className="flex cursor-pointer list-none items-center gap-4 px-4 py-3 hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={box.number}>{box.number}</p>
        <p className="truncate text-xs text-muted-foreground">{box.courier || "Transportadora pendiente"}{box.trackingNumber ? <> · guía <span className="font-mono">{box.trackingNumber}</span></> : " · guía pendiente"}</p>
      </div>
      <div className="hidden shrink-0 text-right text-sm sm:block"><p>{box.customerCount} cliente{box.customerCount === 1 ? "" : "s"}</p><p className="text-xs text-muted-foreground">{box.totalUnits} unidad{box.totalUnits === 1 ? "" : "es"}</p></div>
      <Badge variant={box.status === "enviada" ? "secondary" : "outline"} className="shrink-0">{boxStatusLabel(box.status)}</Badge>
      <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
    </summary>
    <div className="space-y-3 border-t bg-muted/20 px-4 py-3">
      <div className="divide-y rounded-md border bg-background">
        {box.packages.map((item) => <div key={item.sessionId} className="p-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <p className="truncate font-medium" title={item.customerName}>{item.customerName}</p>
              <p className="truncate font-mono text-xs text-muted-foreground" title={item.labelCode}>{item.labelCode}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground" title={`${item.deliveryAddress}, ${item.deliveryCity}`}>{item.deliveryAddress}, {item.deliveryCity}</p>
              {item.requiresLocalInvoice && <Badge variant="outline" className="mt-1.5"><FileText />Requiere factura local</Badge>}
            </div>
            <div className="sm:text-right"><p className="font-semibold">{balanceLabel(item.remainingBalance)}</p><p className="text-xs text-muted-foreground">{item.products.length} línea{item.products.length === 1 ? "" : "s"} de producto</p></div>
          </div>
          <div className="mt-2 space-y-1 border-t pt-2 text-xs text-muted-foreground">{item.products.map((product, index) => <div key={`${item.sessionId}-${index}`} className="flex justify-between gap-3"><span className="min-w-0 truncate">{product.quantity} × {product.name}</span><span className="shrink-0">{formatCurrency(product.price * product.quantity)}</span></div>)}</div>
        </div>)}
      </div>

      <BoxSettlementSummary settlement={box.settlement} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Creada {formatDateTimeEs(box.createdAt)}{box.receivedAt ? ` · Recibida ${formatDateTimeEs(box.receivedAt)}` : " · Revisa las etiquetas antes de entregar."}</p>
        {box.status === "enviada" && onReceive ? <ReceiveBoxDialog boxNumber={box.number} onConfirm={onReceive} /> : <Badge><CheckCircle2 />Recibida por el equipo local</Badge>}
      </div>
    </div>
  </details>
}

function BoxListSection({ title, description, boxes, emptyMessage, onReceive }: { title: string; description: string; boxes: ConsolidatedBoxManifest[]; emptyMessage: string; onReceive?: (box: ConsolidatedBoxManifest) => Promise<void> }) {
  return <section className="overflow-hidden rounded-lg border bg-background"><div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4"><div><h2 className="text-xl font-semibold">{title}</h2><p className="text-sm text-muted-foreground">{description}</p></div><Badge variant="outline">{boxes.length} caja{boxes.length === 1 ? "" : "s"}</Badge></div>{boxes.length === 0 ? <p className="px-6 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p> : <div>{boxes.map((box) => <BoxDetails key={box.id} box={box} onReceive={onReceive ? () => onReceive(box) : undefined} />)}</div>}</section>
}

function DeliveryDetailsSheet({ session, boxNumber, onOpenChange, onStripe, onOffline, onConfirmDelivery }: { session: SesionCompra | null; boxNumber?: string; onOpenChange: (open: boolean) => void; onStripe: (sessionId: string) => Promise<void>; onOffline: (sessionId: string, method: "efectivo" | "transferencia") => Promise<void>; onConfirmDelivery: (sessionId: string) => Promise<void> }) {
  if (!session) return null
  const waitingForPayment = deliveryFilterFor(session) === "awaiting_payment"
  const balance = balanceFor(session)
  const paymentMethod = paymentMethodLabel(session)
  return <Sheet open={Boolean(session)} onOpenChange={onOpenChange}>
    <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
      <SheetHeader><SheetTitle>{session.cliente.nombre}</SheetTitle><SheetDescription>Datos de entrega y contenido del paquete de este cliente.</SheetDescription></SheetHeader>
      <div className="space-y-5 py-6">
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Lugar de entrega</p>
            <p className="mt-1 font-medium">{session.deliveryCity || session.envio?.deliveryCity || session.cliente.ciudad || session.cliente.pais}</p>
            <p className="text-sm text-muted-foreground">{session.deliveryAddress || session.envio?.deliveryAddress || "Dirección no registrada"}</p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <a href={whatsappLink(session.cliente.telefono)} target="_blank" rel="noopener noreferrer">
                <Phone />{session.cliente.telefono}
              </a>
            </Button>
          </div>
          <div className="sm:text-right">
            <p className="text-xs text-muted-foreground">Estado del pedido</p>
            <div className="mt-1 flex flex-wrap gap-2 sm:justify-end">
              <Badge variant={deliveryFilterFor(session) === "delivered" ? "outline" : "secondary"}>{deliveryStatusLabel(session)}</Badge>
              {paymentMethod && <Badge variant="outline">{paymentMethod}</Badge>}
            </div>
            <p className="mt-2 text-sm font-semibold">{balanceLabel(balance)}</p>
            {boxNumber && <p className="mt-1 text-xs text-muted-foreground">Llegó en la caja {boxNumber}</p>}
          </div>
        </div>
        {session.requiresLocalInvoice && <Alert><FileText /><AlertTitle>Requiere factura local</AlertTitle><AlertDescription>Este cliente pidió factura de Brash3D SAS. Emítela manualmente antes de cerrar la entrega.</AlertDescription></Alert>}
        <section className="overflow-hidden rounded-lg border"><div className="border-b px-4 py-3"><h3 className="font-semibold">Productos a entregar</h3><p className="text-xs text-muted-foreground">Verifica estos productos y cantidades contra la etiqueta del paquete.</p></div><div className="divide-y">{session.productos.map((product) => <div key={product.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 text-sm"><div className="min-w-0"><p className="truncate font-medium" title={product.nombre}>{product.nombre}</p>{product.sku && <p className="truncate text-xs text-muted-foreground">SKU {product.sku}</p>}</div><span className="whitespace-nowrap text-muted-foreground">× {product.cantidad}</span><span className="whitespace-nowrap font-medium">{formatCurrency(product.precio * product.cantidad)}</span></div>)}</div><div className="space-y-1 border-t bg-muted/30 px-4 py-3 text-sm"><div className="flex justify-between"><span>Total del pedido</span><span className="font-medium">{formatCurrency(session.total)}</span></div><div className="flex justify-between"><span>Pago inicial recibido</span><span>{formatCurrency(session.montoPagadoInicial)}</span></div><div className="flex justify-between font-semibold"><span>{balance > 0 ? "Saldo por cobrar" : "Pago final"}</span><span>{balance > 0 ? formatCurrency(balance) : "Pagado completo"}</span></div></div></section>
        <div className="rounded-lg border p-4 text-sm"><p className="font-medium">Referencia del paquete</p><p className="mt-1 font-mono text-xs text-muted-foreground">{session.envio?.labelCode || "Etiqueta pendiente"}</p><p className="mt-2 text-xs text-muted-foreground">El cliente debe recibir los productos listados arriba en la dirección registrada.</p></div>
      </div>
      {!waitingForPayment && balance === 0 && session.envio?.estado === "recibido_equipo_local" && <SheetFooter className="gap-2 border-t pt-4 sm:flex-col sm:items-stretch sm:space-x-0"><p className="text-sm font-medium">Sin saldo por cobrar</p><p className="text-xs text-muted-foreground">Este cliente pagó el 100% por adelantado. Entrega los productos y confirma.</p><Button onClick={() => void onConfirmDelivery(session.id)}><CheckCircle2 />Confirmar entrega</Button></SheetFooter>}
      {waitingForPayment && <SheetFooter className="gap-2 border-t pt-4 sm:flex-col sm:items-stretch sm:space-x-0"><p className="text-sm font-medium">Cobrar saldo final</p><Button onClick={() => void onStripe(session.id)}><CreditCard />Copiar link de pago Stripe</Button><Button variant="outline" onClick={() => void onOffline(session.id, "efectivo")}><Banknote />Efectivo recibido</Button><Button variant="ghost" className="text-muted-foreground" onClick={() => void onOffline(session.id, "transferencia")}><Landmark />Transferencia (solo si no hay otra opción)</Button></SheetFooter>}
    </SheetContent>
  </Sheet>
}

export function LocalTeamPanel() {
  const router = useRouter()
  const [deliveries, setDeliveries] = useState<SesionCompra[]>([])
  const [incomingBoxes, setIncomingBoxes] = useState<ConsolidatedBoxManifest[]>([])
  const [receivedBoxes, setReceivedBoxes] = useState<ConsolidatedBoxManifest[]>([])
  const [view, setView] = useState<OperationsView>("incoming")
  const [filter, setFilter] = useState<DeliveryFilter>("all")
  const [selectedDelivery, setSelectedDelivery] = useState<SesionCompra | null>(null)
  const [message, setMessage] = useState("")

  const refresh = useCallback(async () => {
    const response = await fetch("/api/local-team", { cache: "no-store" })
    if (!response.ok) return
    const data = await response.json() as { deliveries: SesionCompra[]; boxes?: ConsolidatedBoxManifest[]; incomingBoxes?: ConsolidatedBoxManifest[]; receivedBoxes?: ConsolidatedBoxManifest[] }
    const allBoxes = data.boxes || []
    setDeliveries(data.deliveries)
    setIncomingBoxes(data.incomingBoxes || allBoxes.filter((box) => box.status === "enviada"))
    setReceivedBoxes(data.receivedBoxes || allBoxes.filter((box) => box.status === "recibida"))
    setSelectedDelivery((current) => current ? data.deliveries.find((item) => item.id === current.id) || null : null)
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => { window.clearTimeout(initial); window.clearInterval(timer) }
  }, [refresh])

  async function action(payload: Record<string, unknown>) {
    setMessage("")
    const response = await fetch("/api/local-team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    const result = await response.json() as { error?: string }
    if (!response.ok) throw new Error(result.error || "No se pudo actualizar la entrega")
    await refresh()
  }

  async function runAction(payload: Record<string, unknown>) {
    try {
      await action(payload)
    } catch (caughtError) {
      setMessage(caughtError instanceof Error ? caughtError.message : "No se pudo actualizar la entrega")
    }
  }

  async function receiveBox(boxId: string, boxNumber: string) {
    await action({ action: "receiveBox", boxId })
    setMessage(`${boxNumber} quedó marcada como recibida. Sus paquetes están listos para entrega local.`)
    setView("deliveries")
  }

  async function finalStripe(sessionId: string) {
    const response = await fetch("/api/payments/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, stage: "final" }) })
    const result = await response.json() as { checkoutUrl?: string; error?: string }
    if (!response.ok || !result.checkoutUrl) { setMessage(result.error || "No se pudo crear el link de pago"); return }
    await navigator.clipboard.writeText(result.checkoutUrl)
    setMessage("Link de pago seguro copiado. Envíalo al cliente por WhatsApp.")
  }

  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh() }

  const visibleDeliveries = filter === "all" ? deliveries : deliveries.filter((session) => deliveryFilterFor(session) === filter)
  const counts = deliveryFilters.reduce<Record<DeliveryFilter, number>>((result, item) => { result[item.value] = item.value === "all" ? deliveries.length : deliveries.filter((session) => deliveryFilterFor(session) === item.value).length; return result }, { all: 0, awaiting_payment: 0, ready_for_handover: 0, delivered: 0 })

  return <div className="min-h-screen bg-muted/30">
    <header className="border-b bg-background"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 lg:px-8"><div className="min-w-0"><p className="truncate text-sm text-muted-foreground">Brash3D SAS Colombia</p><h1 className="text-xl font-bold sm:text-2xl">Panel del equipo local</h1></div><div className="flex shrink-0 items-center gap-2"><ModeToggle /><Button variant="outline" onClick={() => void logout()}><LogOut />Cerrar sesión</Button></div></div></header>
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 lg:px-8">
      {message && <Alert><Clipboard /><AlertTitle>Actualización de operaciones</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>}
      <div className="flex flex-wrap gap-2 border-b pb-3"><Button variant={view === "incoming" ? "default" : "outline"} onClick={() => setView("incoming")}><PackageCheck />Cajas en camino <span className="ml-1 opacity-70">{incomingBoxes.length}</span></Button><Button variant={view === "received" ? "default" : "outline"} onClick={() => setView("received")}><CheckCircle2 />Cajas recibidas <span className="ml-1 opacity-70">{receivedBoxes.length}</span></Button><Button variant={view === "deliveries" ? "default" : "outline"} onClick={() => setView("deliveries")}>Entregas a clientes <span className="ml-1 opacity-70">{deliveries.length}</span></Button></div>
      {view === "incoming" ? <BoxListSection title="Cajas consolidadas en camino" description="Estas cajas ya fueron despachadas y esperan que el equipo local confirme la recepción." boxes={incomingBoxes} emptyMessage="No hay cajas despachadas esperando recepción." onReceive={(box) => receiveBox(box.id, box.number)} /> : view === "received" ? <BoxListSection title="Historial de cajas recibidas" description="Historial de solo lectura de las cajas ya confirmadas por el equipo local, con el resumen de cobros de cada una." boxes={receivedBoxes} emptyMessage="Todavía no se ha recibido ninguna caja." /> : <section className="overflow-hidden rounded-lg border bg-background"><div className="border-b px-4 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Entregas a clientes</h2><p className="text-sm text-muted-foreground">Abre un pedido para verificar exactamente qué se le debe entregar a cada cliente.</p></div><Badge variant="outline">{visibleDeliveries.length} en pantalla</Badge></div><div className="mt-4 flex flex-wrap gap-2">{deliveryFilters.map((item) => <Button key={item.value} size="sm" variant={filter === item.value ? "default" : "outline"} onClick={() => setFilter(item.value)}>{item.label}<span className="ml-1 opacity-70">{counts[item.value]}</span></Button>)}</div></div>{visibleDeliveries.length === 0 ? <p className="px-6 py-10 text-center text-sm text-muted-foreground">{deliveries.length === 0 ? "Las entregas aparecen aquí después de recibir una caja consolidada." : "Ninguna entrega coincide con este filtro."}</p> : <div className="divide-y">{visibleDeliveries.map((item) => { const waitingForPayment = deliveryFilterFor(item) === "awaiting_payment"; const delivered = deliveryFilterFor(item) === "delivered"; const balance = balanceFor(item); return <div key={item.id} className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><p className="truncate font-medium" title={item.cliente.nombre}>{item.cliente.nombre}</p><p className="truncate text-sm text-muted-foreground">{item.deliveryCity || item.envio?.deliveryCity || item.cliente.ciudad} · {item.productos.length} producto{item.productos.length === 1 ? "" : "s"}</p><a href={whatsappLink(item.cliente.telefono)} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"><Phone className="size-3" />{item.cliente.telefono}</a><p className="mt-1 truncate text-xs text-muted-foreground" title={item.envio?.labelCode || undefined}>{item.envio?.labelCode || "Etiqueta pendiente"}</p>{item.requiresLocalInvoice && <Badge variant="outline" className="mt-1.5"><FileText />Requiere factura local</Badge>}</div><div className="flex flex-wrap items-center justify-between gap-3 sm:min-w-72 sm:justify-end"><div className="min-w-0 text-left sm:text-right"><p className="whitespace-nowrap font-semibold">{balanceLabel(balance)}</p><div className="flex flex-wrap items-center gap-2 sm:justify-end"><Badge variant={delivered ? "outline" : "secondary"}>{deliveryStatusLabel(item)}</Badge>{paymentMethodLabel(item) && <span className="truncate text-xs text-muted-foreground">{paymentMethodLabel(item)}</span>}</div></div><Button size="sm" variant="outline" onClick={() => setSelectedDelivery(item)}>Ver pedido</Button>{!waitingForPayment && !delivered && balance === 0 && item.envio?.estado === "recibido_equipo_local" && <Button size="sm" onClick={() => void runAction({ action: "confirmDeliveryWithoutBalance", sessionId: item.id })}><CheckCircle2 />Confirmar entrega</Button>}{waitingForPayment && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Acciones para ${item.cliente.nombre}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>Cobrar saldo</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void finalStripe(item.id)}><CreditCard />Copiar link de pago Stripe</DropdownMenuItem><DropdownMenuItem onSelect={() => void runAction({ action: "recordOfflinePayment", sessionId: item.id, method: "efectivo" })}><Banknote />Efectivo recibido</DropdownMenuItem><DropdownMenuItem className="text-muted-foreground" onSelect={() => void runAction({ action: "recordOfflinePayment", sessionId: item.id, method: "transferencia" })}><Landmark />Transferencia (solo si no hay otra opción)</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div></div> })}</div>}</section>}
      <DeliveryDetailsSheet session={selectedDelivery} boxNumber={[...incomingBoxes, ...receivedBoxes].find((box) => box.id === selectedDelivery?.envio?.cajaId)?.number} onOpenChange={(open) => { if (!open) setSelectedDelivery(null) }} onStripe={finalStripe} onOffline={(sessionId, method) => runAction({ action: "recordOfflinePayment", sessionId, method })} onConfirmDelivery={(sessionId) => runAction({ action: "confirmDeliveryWithoutBalance", sessionId })} />
    </main>
  </div>
}
