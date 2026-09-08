"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Clipboard, LogOut, MoreHorizontal, PackageCheck } from "lucide-react"
import { useRouter } from "next/navigation"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ModeToggle } from "@/components/mode-toggle"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { ConsolidatedBoxManifest, SesionCompra } from "@/lib/types"
import { formatCurrency, formatDateTime } from "@/lib/utils"

type OperationsView = "incoming" | "received" | "deliveries"
type DeliveryFilter = "all" | "awaiting_payment" | "ready_for_handover" | "delivered"

const deliveryFilters: Array<{ value: DeliveryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "awaiting_payment", label: "Awaiting payment" },
  { value: "ready_for_handover", label: "Ready for handover" },
  { value: "delivered", label: "Delivered" },
]

function deliveryFilterFor(session: SesionCompra): DeliveryFilter {
  if (session.envio?.estado === "entregado") return "delivered"
  if (session.montoPagado35 > 0) return "ready_for_handover"
  return "awaiting_payment"
}

function deliveryStatusLabel(session: SesionCompra): string {
  if (session.envio?.estado === "entregado") return "Delivered"
  if (session.montoPagado35 > 0) return "Ready for handover"
  return "Awaiting payment"
}

function paymentMethodLabel(session: SesionCompra): string {
  if (session.montoPagado35 <= 0) return "Payment pending"
  if (session.envio?.metodoPagoRecibido === "stripe") return "Stripe"
  if (session.envio?.metodoPagoRecibido === "efectivo") return "Cash"
  if (session.envio?.metodoPagoRecibido === "transferencia") return "Bank transfer"
  return "Payment received"
}

function balanceLabel(amount: number): string {
  return amount > 0 ? `Balance ${formatCurrency(amount)}` : "Paid in full"
}

function boxStatusLabel(status: string): string {
  return status === "enviada" ? "In transit" : "Received"
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
      setError(caughtError instanceof Error ? caughtError.message : "Unable to mark the box as received")
    } finally {
      setSaving(false)
    }
  }

  return <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setError("") }}>
    <DialogTrigger asChild><Button size="sm">Confirm box received</Button></DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Mark {boxNumber} as received?</DialogTitle><DialogDescription>Confirm that the consolidated box physically arrived in Colombia. Its packages will move to the local delivery queue.</DialogDescription></DialogHeader>
      <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">Review the labels and package count before confirming receipt.</div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button><Button type="button" onClick={() => void confirm()} disabled={saving}>{saving ? "Confirming…" : "Yes, box received"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function BoxDetails({ box, onReceive }: { box: ConsolidatedBoxManifest; onReceive?: () => Promise<void> }) {
  return <details className="group border-b last:border-b-0">
    <summary className="flex cursor-pointer list-none items-center gap-4 px-4 py-3 hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={box.number}>{box.number}</p>
        <p className="truncate text-xs text-muted-foreground">{box.courier || "Courier pending"} · {box.trackingNumber || "Tracking pending"}</p>
      </div>
      <div className="hidden shrink-0 text-right text-sm sm:block"><p>{box.customerCount} customer{box.customerCount === 1 ? "" : "s"}</p><p className="text-xs text-muted-foreground">{box.totalUnits} unit{box.totalUnits === 1 ? "" : "s"}</p></div>
      <Badge variant={box.status === "enviada" ? "secondary" : "outline"} className="shrink-0">{boxStatusLabel(box.status)}</Badge>
      <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
    </summary>
    <div className="border-t bg-muted/20 px-4 py-3">
      <div className="divide-y rounded-md border bg-background">
        {box.packages.map((item) => <div key={item.sessionId} className="p-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0"><p className="truncate font-medium" title={item.customerName}>{item.customerName}</p><p className="truncate font-mono text-xs text-muted-foreground" title={item.labelCode}>{item.labelCode}</p><p className="mt-1 truncate text-xs text-muted-foreground" title={`${item.deliveryAddress}, ${item.deliveryCity}`}>{item.deliveryAddress}, {item.deliveryCity}</p></div>
            <div className="sm:text-right"><p className="font-semibold">{balanceLabel(item.remainingBalance)}</p><p className="text-xs text-muted-foreground">{item.products.length} product line{item.products.length === 1 ? "" : "s"}</p></div>
          </div>
          <div className="mt-2 space-y-1 border-t pt-2 text-xs text-muted-foreground">{item.products.map((product, index) => <div key={`${item.sessionId}-${index}`} className="flex justify-between gap-3"><span className="min-w-0 truncate">{product.quantity} × {product.name}</span><span className="shrink-0">{formatCurrency(product.price * product.quantity)}</span></div>)}</div>
        </div>)}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Created {formatDateTime(box.createdAt)}{box.receivedAt ? ` · Received ${formatDateTime(box.receivedAt)}` : " · Review labels before handover."}</p>
        {box.status === "enviada" && onReceive ? <ReceiveBoxDialog boxNumber={box.number} onConfirm={onReceive} /> : <Badge><CheckCircle2 />Received by local team</Badge>}
      </div>
    </div>
  </details>
}

function BoxListSection({ title, description, boxes, emptyMessage, onReceive }: { title: string; description: string; boxes: ConsolidatedBoxManifest[]; emptyMessage: string; onReceive?: (box: ConsolidatedBoxManifest) => Promise<void> }) {
  return <section className="overflow-hidden rounded-lg border bg-background"><div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4"><div><h2 className="text-xl font-semibold">{title}</h2><p className="text-sm text-muted-foreground">{description}</p></div><Badge variant="outline">{boxes.length} box{boxes.length === 1 ? "" : "es"}</Badge></div>{boxes.length === 0 ? <p className="px-6 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p> : <div>{boxes.map((box) => <BoxDetails key={box.id} box={box} onReceive={onReceive ? () => onReceive(box) : undefined} />)}</div>}</section>
}

function DeliveryDetailsSheet({ session, onOpenChange, onStripe, onOffline }: { session: SesionCompra | null; onOpenChange: (open: boolean) => void; onStripe: (sessionId: string) => Promise<void>; onOffline: (sessionId: string, method: "efectivo" | "transferencia") => Promise<void> }) {
  if (!session) return null
  const waitingForPayment = deliveryFilterFor(session) === "awaiting_payment"
  const balance = Math.max(0, session.total * .35 - session.montoPagado35)
  return <Sheet open={Boolean(session)} onOpenChange={onOpenChange}>
    <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
      <SheetHeader><SheetTitle>{session.cliente.nombre}</SheetTitle><SheetDescription>Delivery details and package contents for this customer.</SheetDescription></SheetHeader>
      <div className="space-y-5 py-6">
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Delivery location</p><p className="mt-1 font-medium">{session.deliveryCity || session.envio?.deliveryCity || session.cliente.ciudad || session.cliente.pais}</p><p className="text-sm text-muted-foreground">{session.deliveryAddress || session.envio?.deliveryAddress || "Address not recorded"}</p></div><div className="sm:text-right"><p className="text-xs text-muted-foreground">Order status</p><div className="mt-1 flex flex-wrap gap-2 sm:justify-end"><Badge variant={deliveryFilterFor(session) === "delivered" ? "outline" : "secondary"}>{deliveryStatusLabel(session)}</Badge><Badge variant="outline">{paymentMethodLabel(session)}</Badge></div><p className="mt-2 text-sm font-semibold">{balanceLabel(balance)}</p></div></div>
        <section className="overflow-hidden rounded-lg border"><div className="border-b px-4 py-3"><h3 className="font-semibold">Items to deliver</h3><p className="text-xs text-muted-foreground">Verify these products and quantities against the package label.</p></div><div className="divide-y">{session.productos.map((product) => <div key={product.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 text-sm"><div className="min-w-0"><p className="truncate font-medium" title={product.nombre}>{product.nombre}</p>{product.sku && <p className="truncate text-xs text-muted-foreground">SKU {product.sku}</p>}</div><span className="whitespace-nowrap text-muted-foreground">× {product.cantidad}</span><span className="whitespace-nowrap font-medium">{formatCurrency(product.precio * product.cantidad)}</span></div>)}</div><div className="space-y-1 border-t bg-muted/30 px-4 py-3 text-sm"><div className="flex justify-between"><span>Order total</span><span className="font-medium">{formatCurrency(session.total)}</span></div><div className="flex justify-between"><span>65% paid</span><span>{formatCurrency(session.montoPagado65)}</span></div><div className="flex justify-between font-semibold"><span>{balance > 0 ? "35% balance" : "Final payment"}</span><span>{balanceLabel(balance)}</span></div></div></section>
        <div className="rounded-lg border p-4 text-sm"><p className="font-medium">Package reference</p><p className="mt-1 font-mono text-xs text-muted-foreground">{session.envio?.labelCode || "Shipment label pending"}</p><p className="mt-2 text-xs text-muted-foreground">The customer should receive the products listed above at the recorded address.</p></div>
      </div>
      {waitingForPayment && <SheetFooter className="gap-2 border-t pt-4 sm:flex-col sm:items-stretch sm:space-x-0"><p className="text-sm font-medium">Collect final balance</p><Button onClick={() => void onStripe(session.id)}><Clipboard />Copy Stripe payment link</Button><Button variant="outline" onClick={() => void onOffline(session.id, "efectivo")}>Cash received</Button><Button variant="ghost" onClick={() => void onOffline(session.id, "transferencia")}>Bank transfer only if necessary</Button></SheetFooter>}
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
    if (!response.ok) throw new Error(result.error || "Unable to update delivery")
    await refresh()
  }

  async function runAction(payload: Record<string, unknown>) {
    try {
      await action(payload)
    } catch (caughtError) {
      setMessage(caughtError instanceof Error ? caughtError.message : "Unable to update delivery")
    }
  }

  async function receiveBox(boxId: string, boxNumber: string) {
    await action({ action: "receiveBox", boxId })
    setMessage(`${boxNumber} is marked as received. Its packages are ready for local delivery.`)
    setView("deliveries")
  }

  async function finalStripe(sessionId: string) {
    const response = await fetch("/api/payments/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, stage: "35" }) })
    const result = await response.json() as { checkoutUrl?: string; error?: string }
    if (!response.ok || !result.checkoutUrl) { setMessage(result.error || "Unable to create payment link"); return }
    await navigator.clipboard.writeText(result.checkoutUrl)
    setMessage("Secure 35% Stripe payment link copied. Send it to the customer through WhatsApp.")
  }

  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh() }

  const visibleDeliveries = filter === "all" ? deliveries : deliveries.filter((session) => deliveryFilterFor(session) === filter)
  const counts = deliveryFilters.reduce<Record<DeliveryFilter, number>>((result, item) => { result[item.value] = item.value === "all" ? deliveries.length : deliveries.filter((session) => deliveryFilterFor(session) === item.value).length; return result }, { all: 0, awaiting_payment: 0, ready_for_handover: 0, delivered: 0 })

  return <div className="min-h-screen bg-muted/30">
    <header className="border-b bg-background"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 lg:px-8"><div className="min-w-0"><p className="text-sm text-muted-foreground">Brash3D SAS Colombia</p><h1 className="truncate text-2xl font-bold">Local delivery operations</h1></div><div className="flex shrink-0 items-center gap-2"><ModeToggle /><Button variant="outline" onClick={() => void logout()}><LogOut />Sign out</Button></div></div></header>
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 lg:px-8">
      {message && <Alert><Clipboard /><AlertTitle>Operations update</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>}
      <div className="flex flex-wrap gap-2 border-b pb-3"><Button variant={view === "incoming" ? "default" : "outline"} onClick={() => setView("incoming")}><PackageCheck />Incoming boxes <span className="ml-1 opacity-70">{incomingBoxes.length}</span></Button><Button variant={view === "received" ? "default" : "outline"} onClick={() => setView("received")}><CheckCircle2 />Received history <span className="ml-1 opacity-70">{receivedBoxes.length}</span></Button><Button variant={view === "deliveries" ? "default" : "outline"} onClick={() => setView("deliveries")}>Customer deliveries <span className="ml-1 opacity-70">{deliveries.length}</span></Button></div>
      {view === "incoming" ? <BoxListSection title="Incoming consolidated boxes" description="These boxes were dispatched and are waiting for the local team to confirm receipt." boxes={incomingBoxes} emptyMessage="No dispatched boxes are waiting for receipt." onReceive={(box) => receiveBox(box.id, box.number)} /> : view === "received" ? <BoxListSection title="Received box history" description="Read-only history of boxes already confirmed by the local team." boxes={receivedBoxes} emptyMessage="No boxes have been received yet." /> : <section className="overflow-hidden rounded-lg border bg-background"><div className="border-b px-4 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Customer deliveries</h2><p className="text-sm text-muted-foreground">Open an order to verify exactly what must be handed to each customer.</p></div><Badge variant="outline">{visibleDeliveries.length} shown</Badge></div><div className="mt-4 flex flex-wrap gap-2">{deliveryFilters.map((item) => <Button key={item.value} size="sm" variant={filter === item.value ? "default" : "outline"} onClick={() => setFilter(item.value)}>{item.label}<span className="ml-1 opacity-70">{counts[item.value]}</span></Button>)}</div></div>{visibleDeliveries.length === 0 ? <p className="px-6 py-10 text-center text-sm text-muted-foreground">{deliveries.length === 0 ? "Customer deliveries appear here after you receive a consolidated box." : "No deliveries match this filter."}</p> : <div className="divide-y">{visibleDeliveries.map((item) => { const waitingForPayment = deliveryFilterFor(item) === "awaiting_payment"; const delivered = deliveryFilterFor(item) === "delivered"; const balance = Math.max(0, item.total * .35 - item.montoPagado35); return <div key={item.id} className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><p className="truncate font-medium" title={item.cliente.nombre}>{item.cliente.nombre}</p><p className="truncate text-sm text-muted-foreground">{item.cliente.ciudad || item.cliente.pais} · {item.productos.length} product{item.productos.length === 1 ? "" : "s"}</p><p className="mt-1 truncate text-xs text-muted-foreground" title={item.envio?.labelCode || undefined}>{item.envio?.labelCode || "Shipment label pending"}</p></div><div className="flex flex-wrap items-center justify-between gap-3 sm:min-w-72 sm:justify-end"><div className="min-w-0 text-left sm:text-right"><p className="whitespace-nowrap font-semibold">{balanceLabel(balance)}</p><div className="flex flex-wrap items-center gap-2 sm:justify-end"><Badge variant={delivered ? "outline" : "secondary"}>{deliveryStatusLabel(item)}</Badge><span className="truncate text-xs text-muted-foreground">{paymentMethodLabel(item)}</span></div></div><Button size="sm" variant="outline" onClick={() => setSelectedDelivery(item)}>View order</Button>{waitingForPayment && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${item.cliente.nombre}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>Collect balance</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void finalStripe(item.id)}><Clipboard />Copy Stripe payment link</DropdownMenuItem><DropdownMenuItem onSelect={() => void runAction({ action: "recordOfflinePayment", sessionId: item.id, method: "efectivo" })}>Cash received</DropdownMenuItem><DropdownMenuItem onSelect={() => void runAction({ action: "recordOfflinePayment", sessionId: item.id, method: "transferencia" })}>Bank transfer only if necessary</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div></div> })}</div>}</section>}
      <DeliveryDetailsSheet session={selectedDelivery} onOpenChange={(open) => { if (!open) setSelectedDelivery(null) }} onStripe={finalStripe} onOffline={(sessionId, method) => runAction({ action: "recordOfflinePayment", sessionId, method })} />
    </main>
  </div>
}
