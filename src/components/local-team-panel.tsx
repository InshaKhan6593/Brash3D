"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Banknote, CheckCircle2, Clipboard, CreditCard, FileText, Landmark, LogOut, MoreHorizontal, PackageCheck, Phone, Wallet } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { CopyToast, copyToast, type CopyToastState } from "@/components/copy-toast"
import { LanguageToggle } from "@/components/language-toggle"
import { ModeToggle } from "@/components/mode-toggle"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { BoxSettlement, ConsolidatedBoxManifest, LocalTeamIdentity, SesionCompra } from "@/lib/types"
import { outstandingBalance } from "@/lib/payment-split"
import { countryFor } from "@/lib/countries"
import { intlLocale } from "@/lib/i18n/locale"
import type { Messages } from "@/lib/i18n/messages"
import { useLocale } from "@/lib/i18n/provider"
import { copyText } from "@/lib/clipboard"
import { formatCurrency, formatDateTimeEs } from "@/lib/utils"

type OperationsView = "incoming" | "received" | "deliveries"
type DeliveryFilter = "all" | "awaiting_payment" | "ready_for_handover" | "delivered"

/** Order is deliberate: the queue the team works through, most urgent first. */
const DELIVERY_FILTERS: readonly DeliveryFilter[] = ["all", "awaiting_payment", "ready_for_handover", "delivered"]

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

function deliveryStatusLabel(session: SesionCompra, t: Messages): string {
  if (session.envio?.estado === "entregado") return t.localTeam.status.delivered
  if (session.montoPagadoFinal > 0 || balanceFor(session) === 0) return t.localTeam.status.ready
  return t.localTeam.status.awaitingPayment
}

function paymentMethodLabel(session: SesionCompra, t: Messages): string | null {
  const copy = t.localTeam.method
  if (session.montoPagadoFinal <= 0 && balanceFor(session) === 0) return copy.prepaid
  if (session.montoPagadoFinal <= 0) return null
  if (session.envio?.metodoPagoRecibido === "stripe") return copy.stripe
  if (session.envio?.metodoPagoRecibido === "efectivo") return copy.cash
  if (session.envio?.metodoPagoRecibido === "transferencia") return copy.transfer
  return copy.received
}

// The team delivers in person, so a one-tap WhatsApp link matters more than the
// raw number. Everything else in this business already runs over WhatsApp.
function whatsappLink(phone: string): string {
  return `https://wa.me/${phone.replace(/[^0-9]/g, "")}`
}

function balanceLabel(amount: number, t: Messages): string {
  return amount > 0 ? t.localTeam.balance(formatCurrency(amount)) : t.localTeam.paidInFull
}

function boxStatusLabel(status: string, t: Messages): string {
  return status === "enviada" ? t.localTeam.boxStatus.inTransit : t.localTeam.boxStatus.received
}

// Section 13 of the specification: Stripe collections are US LLC revenue, cash
// and transfers stay in the destination country as the local team's operating
// fund. This is accounting metadata only — the system never moves money between
// entities.
function BoxSettlementSummary({ settlement, country, t }: { settlement: BoxSettlement; country: string; t: Messages }) {
  const copy = t.localTeam.settlement
  const rows = [
    {
      key: "stripe",
      icon: CreditCard,
      label: copy.viaStripe,
      hint: copy.usRevenue,
      amount: settlement.viaStripe,
      emphasis: false,
    },
    {
      key: "local",
      icon: Wallet,
      label: copy.localFund(country),
      hint: settlement.transfer > 0
        ? copy.cashAndTransfer(formatCurrency(settlement.cash), formatCurrency(settlement.transfer))
        : copy.cashOnly,
      amount: settlement.localFund,
      emphasis: true,
    },
  ]

  return (
    <section className="rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">{copy.title}</h4>
          <p className="text-xs text-muted-foreground">
            {copy.collectedOf(settlement.deliveredCount, settlement.deliveredCount + settlement.pendingCount)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">{copy.totalCollected}</p>
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
              {copy.pending}
            </span>
            <span className="tabular-nums font-medium">{formatCurrency(settlement.pending)}</span>
          </div>
        </>
      )}

      <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
        {copy.note}
      </p>
    </section>
  )
}

function ReceiveBoxDialog({ boxNumber, country, t, onConfirm }: { boxNumber: string; country: string; t: Messages; onConfirm: () => Promise<void> }) {
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
      setError(caughtError instanceof Error ? caughtError.message : t.localTeam.receiveError)
    } finally {
      setSaving(false)
    }
  }

  return <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setError("") }}>
    <DialogTrigger asChild><Button size="sm">{t.localTeam.confirmReceipt}</Button></DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>{t.localTeam.confirmReceiptTitle(boxNumber)}</DialogTitle><DialogDescription>{t.localTeam.confirmReceiptBody(country)}</DialogDescription></DialogHeader>
      <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{t.localTeam.confirmReceiptHint}</div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>{t.localTeam.cancel}</Button><Button type="button" onClick={() => void confirm()} disabled={saving}>{saving ? t.localTeam.confirming : t.localTeam.yesReceived}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

type OfflineMethod = "efectivo" | "transferencia"

/**
 * Confirms a cash or transfer collection before it is recorded.
 *
 * Recording one closes the delivery and there is no undo, so it should not be
 * one click away in a dropdown. It also warns when a Stripe link for the same
 * balance is still outstanding, which is the case that produces a double
 * charge: the team sends the link, the customer pays cash, and the link stays
 * payable. Confirming here expires it server-side.
 */
function ConfirmOfflinePaymentDialog({ pending, t, onCancel, onConfirm }: {
  pending: { session: SesionCompra; method: OfflineMethod } | null
  t: Messages
  onCancel: () => void
  onConfirm: (session: SesionCompra, method: OfflineMethod) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)

  if (!pending) return null
  const copy = t.localTeam.confirmOffline
  const { session, method } = pending
  const isCash = method === "efectivo"
  // A live Stripe link for this balance is exactly the duplicate-payment risk.
  const stripeLinkOpen = Boolean(session.checkoutSessionFinalId)

  async function confirm() {
    setSaving(true)
    try {
      await onConfirm(session, method)
    } finally {
      setSaving(false)
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onCancel() }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{isCash ? copy.titleCash : copy.titleTransfer}</DialogTitle>
        <DialogDescription>
          {copy.body(session.cliente.nombre, formatCurrency(balanceFor(session)))}
        </DialogDescription>
      </DialogHeader>
      {stripeLinkOpen && <Alert>
        <AlertTriangle />
        <AlertTitle>{copy.stripeWarningTitle}</AlertTitle>
        <AlertDescription>{copy.stripeWarning}</AlertDescription>
      </Alert>}
      <p className="text-sm text-muted-foreground">{copy.irreversible}</p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>{t.localTeam.cancel}</Button>
        <Button type="button" onClick={() => void confirm()} disabled={saving}>
          {saving ? copy.recording : isCash ? copy.confirmCash : copy.confirmTransfer}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

function BoxDetails({ box, t, dateLocale, onReceive }: { box: ConsolidatedBoxManifest; t: Messages; dateLocale: string; onReceive?: () => Promise<void> }) {
  return <details className="group border-b last:border-b-0">
    <summary className="flex cursor-pointer list-none items-center gap-4 px-4 py-3 hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={box.number}>{box.number}</p>
        <p className="truncate text-xs text-muted-foreground">{box.courier || t.localTeam.courierPending}{box.trackingNumber ? <>{t.localTeam.trackingPrefix}<span className="font-mono">{box.trackingNumber}</span></> : t.localTeam.trackingPending}</p>
      </div>
      <div className="hidden shrink-0 text-right text-sm sm:block"><p>{t.localTeam.customers(box.customerCount)}</p><p className="text-xs text-muted-foreground">{t.localTeam.units(box.totalUnits)}</p></div>
      <Badge variant={box.status === "enviada" ? "secondary" : "outline"} className="shrink-0">{boxStatusLabel(box.status, t)}</Badge>
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
              {item.requiresLocalInvoice && <Badge variant="outline" className="mt-1.5"><FileText />{t.localTeam.requiresLocalInvoice}</Badge>}
            </div>
            <div className="sm:text-right"><p className="font-semibold">{balanceLabel(item.remainingBalance, t)}</p><p className="text-xs text-muted-foreground">{t.localTeam.productLines(item.products.length)}</p></div>
          </div>
          <div className="mt-2 space-y-1 border-t pt-2 text-xs text-muted-foreground">{item.products.map((product, index) => <div key={`${item.sessionId}-${index}`} className="flex justify-between gap-3"><span className="min-w-0 truncate">{product.quantity} × {product.name}</span><span className="shrink-0">{formatCurrency(product.price * product.quantity)}</span></div>)}</div>
        </div>)}
      </div>

      <BoxSettlementSummary settlement={box.settlement} country={box.country} t={t} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t.localTeam.createdAt(formatDateTimeEs(box.createdAt, dateLocale))}{box.receivedAt ? t.localTeam.receivedAt(formatDateTimeEs(box.receivedAt, dateLocale)) : t.localTeam.checkLabels}</p>
        {box.status === "enviada" && onReceive ? <ReceiveBoxDialog boxNumber={box.number} country={box.country} t={t} onConfirm={onReceive} /> : <Badge><CheckCircle2 />{t.localTeam.receivedByTeam}</Badge>}
      </div>
    </div>
  </details>
}

function BoxListSection({ title, description, boxes, emptyMessage, t, dateLocale, onReceive }: { title: string; description: string; boxes: ConsolidatedBoxManifest[]; emptyMessage: string; t: Messages; dateLocale: string; onReceive?: (box: ConsolidatedBoxManifest) => Promise<void> }) {
  return <section className="overflow-hidden rounded-lg border bg-background"><div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4"><div><h2 className="text-xl font-semibold">{title}</h2><p className="text-sm text-muted-foreground">{description}</p></div><Badge variant="outline">{t.localTeam.boxCount(boxes.length)}</Badge></div>{boxes.length === 0 ? <p className="px-6 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p> : <div>{boxes.map((box) => <BoxDetails key={box.id} box={box} t={t} dateLocale={dateLocale} onReceive={onReceive ? () => onReceive(box) : undefined} />)}</div>}</section>
}

function DeliveryDetailsSheet({ session, boxNumber, t, onOpenChange, onStripe, onOffline, onConfirmDelivery }: { session: SesionCompra | null; boxNumber?: string; t: Messages; onOpenChange: (open: boolean) => void; onStripe: (sessionId: string) => Promise<void>; onOffline: (session: SesionCompra, method: OfflineMethod) => void; onConfirmDelivery: (sessionId: string) => Promise<void> }) {
  if (!session) return null
  const copy = t.localTeam.sheet
  const waitingForPayment = deliveryFilterFor(session) === "awaiting_payment"
  const balance = balanceFor(session)
  const paymentMethod = paymentMethodLabel(session, t)
  return <Sheet open={Boolean(session)} onOpenChange={onOpenChange}>
    <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
      <SheetHeader><SheetTitle>{session.cliente.nombre}</SheetTitle><SheetDescription>{copy.description}</SheetDescription></SheetHeader>
      <div className="space-y-5 py-6">
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{copy.place}</p>
            <p className="mt-1 font-medium">{session.deliveryCity || session.envio?.deliveryCity || session.cliente.ciudad || session.cliente.pais}</p>
            <p className="text-sm text-muted-foreground">{session.deliveryAddress || session.envio?.deliveryAddress || copy.noAddress}</p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <a href={whatsappLink(session.cliente.telefono)} target="_blank" rel="noopener noreferrer">
                <Phone />{session.cliente.telefono}
              </a>
            </Button>
          </div>
          <div className="sm:text-right">
            <p className="text-xs text-muted-foreground">{copy.orderStatus}</p>
            <div className="mt-1 flex flex-wrap gap-2 sm:justify-end">
              <Badge variant={deliveryFilterFor(session) === "delivered" ? "outline" : "secondary"}>{deliveryStatusLabel(session, t)}</Badge>
              {paymentMethod && <Badge variant="outline">{paymentMethod}</Badge>}
            </div>
            <p className="mt-2 text-sm font-semibold">{balanceLabel(balance, t)}</p>
            {boxNumber && <p className="mt-1 text-xs text-muted-foreground">{copy.arrivedInBox(boxNumber)}</p>}
          </div>
        </div>
        {session.requiresLocalInvoice && <Alert><FileText /><AlertTitle>{t.localTeam.requiresLocalInvoice}</AlertTitle><AlertDescription>{copy.invoiceAlert}</AlertDescription></Alert>}
        <section className="overflow-hidden rounded-lg border"><div className="border-b px-4 py-3"><h3 className="font-semibold">{copy.products}</h3><p className="text-xs text-muted-foreground">{copy.productsHint}</p></div><div className="divide-y">{session.productos.map((product) => <div key={product.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 text-sm"><div className="min-w-0"><p className="truncate font-medium" title={product.nombre}>{product.nombre}</p>{product.sku && <p className="truncate text-xs text-muted-foreground">SKU {product.sku}</p>}</div><span className="whitespace-nowrap text-muted-foreground">× {product.cantidad}</span><span className="whitespace-nowrap font-medium">{formatCurrency(product.precio * product.cantidad)}</span></div>)}</div><div className="space-y-1 border-t bg-muted/30 px-4 py-3 text-sm"><div className="flex justify-between"><span>{copy.orderTotal}</span><span className="font-medium">{formatCurrency(session.total)}</span></div><div className="flex justify-between"><span>{copy.initialReceived}</span><span>{formatCurrency(session.montoPagadoInicial)}</span></div><div className="flex justify-between font-semibold"><span>{balance > 0 ? copy.balanceDue : copy.finalPayment}</span><span>{balance > 0 ? formatCurrency(balance) : t.localTeam.paidInFull}</span></div></div></section>
        <div className="rounded-lg border p-4 text-sm"><p className="font-medium">{copy.reference}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{session.envio?.labelCode || copy.labelPending}</p><p className="mt-2 text-xs text-muted-foreground">{copy.referenceHint}</p></div>
      </div>
      {!waitingForPayment && balance === 0 && session.envio?.estado === "recibido_equipo_local" && <SheetFooter className="gap-2 border-t pt-4 sm:flex-col sm:items-stretch sm:space-x-0"><p className="text-sm font-medium">{copy.noBalanceTitle}</p><p className="text-xs text-muted-foreground">{copy.noBalanceBody}</p><Button onClick={() => void onConfirmDelivery(session.id)}><CheckCircle2 />{copy.confirmDelivery}</Button></SheetFooter>}
      {waitingForPayment && <SheetFooter className="gap-2 border-t pt-4 sm:flex-col sm:items-stretch sm:space-x-0"><p className="text-sm font-medium">{copy.collectBalance}</p><Button onClick={() => void onStripe(session.id)}><CreditCard />{copy.copyStripeLink}</Button><Button variant="outline" onClick={() => onOffline(session, "efectivo")}><Banknote />{copy.cashReceived}</Button><Button variant="ghost" className="text-muted-foreground" onClick={() => onOffline(session, "transferencia")}><Landmark />{copy.transfer}</Button></SheetFooter>}
    </SheetContent>
  </Sheet>
}

export function LocalTeamPanel() {
  const { locale, t } = useLocale()
  const [team, setTeam] = useState<LocalTeamIdentity | null>(null)
  const [deliveries, setDeliveries] = useState<SesionCompra[]>([])
  const [incomingBoxes, setIncomingBoxes] = useState<ConsolidatedBoxManifest[]>([])
  const [receivedBoxes, setReceivedBoxes] = useState<ConsolidatedBoxManifest[]>([])
  const [view, setView] = useState<OperationsView>("incoming")
  const [filter, setFilter] = useState<DeliveryFilter>("all")
  const [selectedDelivery, setSelectedDelivery] = useState<SesionCompra | null>(null)
  // The collection awaiting confirmation. Held here rather than per row so one
  // dialog serves both the row menu and the detail sheet.
  const [pendingOffline, setPendingOffline] = useState<{ session: SesionCompra; method: OfflineMethod } | null>(null)
  // Confirms the Stripe balance link was copied.
  const [toast, setToast] = useState<CopyToastState | null>(null)
  const [message, setMessage] = useState("")

  const refresh = useCallback(async () => {
    const response = await fetch("/api/local-team", { cache: "no-store" })
    if (!response.ok) return
    const data = await response.json() as { team?: LocalTeamIdentity | null; deliveries: SesionCompra[]; boxes?: ConsolidatedBoxManifest[]; incomingBoxes?: ConsolidatedBoxManifest[]; receivedBoxes?: ConsolidatedBoxManifest[] }
    const allBoxes = data.boxes || []
    setTeam(data.team || null)
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
    if (!response.ok) throw new Error(result.error || t.localTeam.updateError)
    await refresh()
  }

  async function runAction(payload: Record<string, unknown>) {
    try {
      await action(payload)
    } catch (caughtError) {
      setMessage(caughtError instanceof Error ? caughtError.message : t.localTeam.updateError)
    }
  }

  async function recordOfflinePayment(session: SesionCompra, method: OfflineMethod) {
    setPendingOffline(null)
    await runAction({ action: "recordOfflinePayment", sessionId: session.id, method })
  }

  async function receiveBox(boxId: string, boxNumber: string) {
    await action({ action: "receiveBox", boxId })
    setMessage(t.localTeam.boxReceived(boxNumber))
    setView("deliveries")
  }

  /**
   * Creates the Stripe balance link and copies it.
   *
   * Two problems with the old version. `navigator.clipboard.writeText` was not
   * guarded, so a blocked clipboard rejected and skipped the confirmation
   * entirely -- the team saw nothing at all and had no idea whether the link
   * they were about to paste was the right one. And the confirmation it did set
   * rendered in the alert at the top of the page, which sits behind the
   * delivery sheet the button is usually pressed from.
   *
   * A toast fixes both: it reports the outcome, and it sits above the sheet.
   */
  async function finalStripe(sessionId: string) {
    setMessage("")
    const response = await fetch("/api/payments/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, stage: "final" }) })
    const result = await response.json() as { checkoutUrl?: string; error?: string }
    if (!response.ok || !result.checkoutUrl) { setToast(copyToast("error", result.error || t.localTeam.linkError)); return }
    setToast(await copyText(result.checkoutUrl)
      ? copyToast("ok", t.localTeam.linkCopied)
      : copyToast("error", t.localTeam.clipboardBlocked))
  }

  // Full document load: a soft navigation would keep this panel's fetched data
  // in memory and can reuse the router's stale entry for /login.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a soft navigation is exactly what breaks here.
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/login") }

  const visibleDeliveries = filter === "all" ? deliveries : deliveries.filter((session) => deliveryFilterFor(session) === filter)
  const counts = DELIVERY_FILTERS.reduce<Record<DeliveryFilter, number>>((result, value) => { result[value] = value === "all" ? deliveries.length : deliveries.filter((session) => deliveryFilterFor(session) === value).length; return result }, { all: 0, awaiting_payment: 0, ready_for_handover: 0, delivered: 0 })
  // The team is in the destination country, so Spanish formats dates the way
  // they read them locally; English falls back to US formatting.
  const dateLocale = intlLocale(locale, countryFor(team?.country).locale)

  return <div className="min-h-screen bg-muted/30">
    <header className="border-b bg-background"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 lg:px-8"><div className="min-w-0"><p className="truncate text-sm text-muted-foreground">{team?.name || "Brash3D"}</p><h1 className="text-xl font-bold sm:text-2xl">{t.localTeam.title}</h1></div><div className="flex shrink-0 items-center gap-2"><LanguageToggle /><ModeToggle /><Button variant="outline" onClick={() => void logout()}><LogOut />{t.localTeam.signOut}</Button></div></div></header>
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 lg:px-8">
      {message && <Alert><Clipboard /><AlertTitle>{t.localTeam.updateTitle}</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>}
      <div className="flex flex-wrap gap-2 border-b pb-3"><Button variant={view === "incoming" ? "default" : "outline"} onClick={() => setView("incoming")}><PackageCheck />{t.localTeam.incoming} <span className="ml-1 opacity-70">{incomingBoxes.length}</span></Button><Button variant={view === "received" ? "default" : "outline"} onClick={() => setView("received")}><CheckCircle2 />{t.localTeam.received} <span className="ml-1 opacity-70">{receivedBoxes.length}</span></Button><Button variant={view === "deliveries" ? "default" : "outline"} onClick={() => setView("deliveries")}>{t.localTeam.deliveries} <span className="ml-1 opacity-70">{deliveries.length}</span></Button></div>
      {view === "incoming" ? <BoxListSection title={t.localTeam.incomingTitle} description={t.localTeam.incomingBody} boxes={incomingBoxes} emptyMessage={t.localTeam.incomingEmpty} t={t} dateLocale={dateLocale} onReceive={(box) => receiveBox(box.id, box.number)} /> : view === "received" ? <BoxListSection title={t.localTeam.receivedTitle} description={t.localTeam.receivedBody} boxes={receivedBoxes} emptyMessage={t.localTeam.receivedEmpty} t={t} dateLocale={dateLocale} /> : <section className="overflow-hidden rounded-lg border bg-background"><div className="border-b px-4 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{t.localTeam.deliveries}</h2><p className="text-sm text-muted-foreground">{t.localTeam.deliveriesBody}</p></div><Badge variant="outline">{t.localTeam.onScreen(visibleDeliveries.length)}</Badge></div><div className="mt-4 flex flex-wrap gap-2">{DELIVERY_FILTERS.map((value) => <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} onClick={() => setFilter(value)}>{t.localTeam.filters[value]}<span className="ml-1 opacity-70">{counts[value]}</span></Button>)}</div></div>{visibleDeliveries.length === 0 ? <p className="px-6 py-10 text-center text-sm text-muted-foreground">{deliveries.length === 0 ? t.localTeam.deliveriesEmpty : t.localTeam.noMatch}</p> : <div className="divide-y">{visibleDeliveries.map((item) => { const waitingForPayment = deliveryFilterFor(item) === "awaiting_payment"; const delivered = deliveryFilterFor(item) === "delivered"; const balance = balanceFor(item); return <div key={item.id} className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><p className="truncate font-medium" title={item.cliente.nombre}>{item.cliente.nombre}</p><p className="truncate text-sm text-muted-foreground">{item.deliveryCity || item.envio?.deliveryCity || item.cliente.ciudad} · {t.session.items(item.productos.length)}</p><a href={whatsappLink(item.cliente.telefono)} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"><Phone className="size-3" />{item.cliente.telefono}</a><p className="mt-1 truncate text-xs text-muted-foreground" title={item.envio?.labelCode || undefined}>{item.envio?.labelCode || t.localTeam.sheet.labelPending}</p>{item.requiresLocalInvoice && <Badge variant="outline" className="mt-1.5"><FileText />{t.localTeam.requiresLocalInvoice}</Badge>}</div><div className="flex flex-wrap items-center justify-between gap-3 sm:min-w-72 sm:justify-end"><div className="min-w-0 text-left sm:text-right"><p className="whitespace-nowrap font-semibold">{balanceLabel(balance, t)}</p><div className="flex flex-wrap items-center gap-2 sm:justify-end"><Badge variant={delivered ? "outline" : "secondary"}>{deliveryStatusLabel(item, t)}</Badge>{paymentMethodLabel(item, t) && <span className="truncate text-xs text-muted-foreground">{paymentMethodLabel(item, t)}</span>}</div></div><Button size="sm" variant="outline" onClick={() => setSelectedDelivery(item)}>{t.localTeam.viewOrder}</Button>{!waitingForPayment && !delivered && balance === 0 && item.envio?.estado === "recibido_equipo_local" && <Button size="sm" onClick={() => void runAction({ action: "confirmDeliveryWithoutBalance", sessionId: item.id })}><CheckCircle2 />{t.localTeam.sheet.confirmDelivery}</Button>}{waitingForPayment && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t.localTeam.actionsFor(item.cliente.nombre)}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>{t.localTeam.collectBalanceMenu}</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void finalStripe(item.id)}><CreditCard />{t.localTeam.sheet.copyStripeLink}</DropdownMenuItem><DropdownMenuItem onSelect={() => setPendingOffline({ session: item, method: "efectivo" })}><Banknote />{t.localTeam.sheet.cashReceived}</DropdownMenuItem><DropdownMenuItem className="text-muted-foreground" onSelect={() => setPendingOffline({ session: item, method: "transferencia" })}><Landmark />{t.localTeam.sheet.transfer}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div></div> })}</div>}</section>}
      <DeliveryDetailsSheet session={selectedDelivery} t={t} boxNumber={[...incomingBoxes, ...receivedBoxes].find((box) => box.id === selectedDelivery?.envio?.cajaId)?.number} onOpenChange={(open) => { if (!open) setSelectedDelivery(null) }} onStripe={finalStripe} onOffline={(session, method) => setPendingOffline({ session, method })} onConfirmDelivery={(sessionId) => runAction({ action: "confirmDeliveryWithoutBalance", sessionId })} />
      <ConfirmOfflinePaymentDialog pending={pendingOffline} t={t} onCancel={() => setPendingOffline(null)} onConfirm={recordOfflinePayment} />
      <CopyToast state={toast} onDismiss={() => setToast(null)} />
    </main>
  </div>
}
