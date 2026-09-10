"use client"

import type { ReactNode } from "react"
import { CheckCircle2, CreditCard, Package, ReceiptText, Truck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CustomerPurchaseHistory, PurchaseHistoryItem } from "@/lib/types"
import { cn, formatCurrency } from "@/lib/utils"

// This table is shared by the Spanish customer order page and the English
// USA seller dashboard, so the copy is selected rather than hard-coded.
export type HistoryLocale = "en" | "es"

const COPY = {
  en: {
    title: "Order history",
    orders: (count: number) => `${count} order${count === 1 ? "" : "s"}`,
    totalSpent: "total spent",
    inTransit: (count: number) => `${count} in transit`,
    empty: "Your completed orders will appear here after your first live-shopping session.",
    columns: { order: "Order", items: "Items", status: "Status", total: "Total", payment: "Payment", tracking: "Tracking" },
    noProduct: "No product details",
    unavailable: "Details unavailable",
    more: (count: number) => `+${count} more item${count === 1 ? "" : "s"}`,
    qty: (count: number) => `Qty ${count}`,
    status: { delivered: "Delivered", customs: "In customs", shipped: "Shipped", processing: "Processing", returned: "Returned", cancelled: "Cancelled", completed: "Completed" },
    payment: { paid: "Paid", partial: "Partial", pending: "Pending" },
  },
  es: {
    title: "Historial de pedidos",
    orders: (count: number) => `${count} pedido${count === 1 ? "" : "s"}`,
    totalSpent: "gastados en total",
    inTransit: (count: number) => `${count} en tránsito`,
    empty: "Tus pedidos completados aparecerán aquí después de tu primera sesión de compra en vivo.",
    columns: { order: "Pedido", items: "Productos", status: "Estado", total: "Total", payment: "Pago", tracking: "Guía" },
    noProduct: "Sin detalle de productos",
    unavailable: "Detalle no disponible",
    more: (count: number) => `+${count} producto${count === 1 ? "" : "s"} más`,
    qty: (count: number) => `Cant. ${count}`,
    status: { delivered: "Entregado", customs: "En aduanas", shipped: "Enviado", processing: "En proceso", returned: "Devuelto", cancelled: "Cancelado", completed: "Completado" },
    payment: { paid: "Pagado", partial: "Parcial", pending: "Pendiente" },
  },
} as const

function purchaseStatus(
  purchase: PurchaseHistoryItem,
  copy: (typeof COPY)[HistoryLocale]
): { label: string; className: string; icon: ReactNode } {
  if (purchase.shipmentStatus === "entregado") return { label: copy.status.delivered, className: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300", icon: <CheckCircle2 /> }
  if (purchase.shipmentStatus === "en_transito" || purchase.shipmentStatus === "en_aduanas") return { label: purchase.shipmentStatus === "en_aduanas" ? copy.status.customs : copy.status.shipped, className: "bg-violet-100 text-violet-700 hover:bg-violet-100 dark:bg-violet-950 dark:text-violet-300", icon: <Truck /> }
  if (purchase.shipmentStatus === "preparacion" || purchase.status === "en_progreso") return { label: copy.status.processing, className: "bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300", icon: <Package /> }
  if (purchase.shipmentStatus === "devuelto") return { label: copy.status.returned, className: "bg-orange-100 text-orange-700 hover:bg-orange-100 dark:bg-orange-950 dark:text-orange-300", icon: <ReceiptText /> }
  return { label: purchase.status === "cancelada" ? copy.status.cancelled : copy.status.completed, className: "bg-secondary text-secondary-foreground", icon: <CheckCircle2 /> }
}

function PurchaseStatusBadge({ purchase, copy }: { purchase: PurchaseHistoryItem; copy: (typeof COPY)[HistoryLocale] }) {
  const status = purchaseStatus(purchase, copy)
  return <Badge variant="outline" className={cn("max-w-full gap-1 overflow-hidden text-ellipsis border-transparent", status.className)}>{status.icon}<span className="truncate">{status.label}</span></Badge>
}

export function PurchaseHistoryTable({ history, locale = "en" }: { history: CustomerPurchaseHistory; locale?: HistoryLocale }) {
  const copy = COPY[locale]
  const dateLocale = locale === "es" ? "es-CO" : "en-US"
  const inTransitCount = history.purchases.filter((purchase) => purchase.shipmentStatus === "en_transito" || purchase.shipmentStatus === "en_aduanas").length
  const totalSpent = history.purchases.reduce((sum, purchase) => sum + purchase.total, 0)

  return <Card className="overflow-hidden">
    <CardHeader className="flex-row items-center justify-between space-y-0 border-b px-4 py-4 sm:px-5">
      <div>
        <CardTitle className="text-lg">{copy.title}</CardTitle>
        <CardDescription>{copy.orders(history.purchases.length)} · {formatCurrency(totalSpent)} {copy.totalSpent}</CardDescription>
      </div>
      {inTransitCount > 0 && <Badge variant="outline" className="gap-1"><Truck />{copy.inTransit(inTransitCount)}</Badge>}
    </CardHeader>
    {history.purchases.length === 0 ? <CardContent className="flex min-h-36 items-center justify-center p-6 text-center text-sm text-muted-foreground">{copy.empty}</CardContent> : <CardContent className="p-0">
      <Table className="w-full table-fixed">
        <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-[27%] sm:w-[20%] lg:w-[17%]">{copy.columns.order}</TableHead><TableHead className="w-[34%] sm:w-[29%] lg:w-[25%]">{copy.columns.items}</TableHead><TableHead className="w-[24%] sm:w-[18%] lg:w-[17%]">{copy.columns.status}</TableHead><TableHead className="w-[15%] text-right sm:w-[14%] lg:w-[13%]">{copy.columns.total}</TableHead><TableHead className="hidden md:table-cell md:w-[13%] lg:w-[13%]">{copy.columns.payment}</TableHead><TableHead className="hidden lg:table-cell lg:w-[15%]">{copy.columns.tracking}</TableHead></TableRow></TableHeader>
        <TableBody>{history.purchases.map((purchase) => {
          const firstProduct = purchase.products[0]
          const extraProducts = Math.max(purchase.products.length - 1, 0)
          const itemIcons = purchase.products.length ? purchase.products.slice(0, 2) : [{ id: `${purchase.sessionId}-empty` }]
          const paymentLabel = purchase.paymentStatus === "paid" ? copy.payment.paid : purchase.paymentStatus === "partial" ? copy.payment.partial : copy.payment.pending
          return <TableRow key={purchase.sessionId}>
            <TableCell className="whitespace-nowrap"><p className="font-mono text-sm font-medium">ORD-{purchase.sessionId.slice(-8).toUpperCase()}</p><p className="text-xs text-muted-foreground">{new Date(purchase.bookedAt).toLocaleDateString(dateLocale, { month: "short", day: "numeric", year: "numeric" })}</p></TableCell>
            <TableCell className="min-w-0"><div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <div className="flex shrink-0 -space-x-1.5">{itemIcons.map((product) => <span key={product.id} className="flex size-8 items-center justify-center rounded-full border bg-muted text-muted-foreground ring-2 ring-background"><Package className="size-3.5" /></span>)}</div>
              <div className="min-w-0"><p className="truncate font-medium">{firstProduct?.nombre || copy.noProduct}</p><p className="text-xs text-muted-foreground">{extraProducts > 0 ? copy.more(extraProducts) : firstProduct ? copy.qty(firstProduct.cantidad) : copy.unavailable}</p></div>
            </div></TableCell>
            <TableCell className="min-w-0"><PurchaseStatusBadge purchase={purchase} copy={copy} /></TableCell>
            <TableCell className="whitespace-nowrap text-right font-semibold">{formatCurrency(purchase.total)}</TableCell>
            <TableCell className="hidden whitespace-nowrap md:table-cell"><span className="inline-flex items-center gap-2 text-sm" title={paymentLabel}><CreditCard className="size-4 shrink-0 text-muted-foreground" /><span className="hidden xl:inline">{paymentLabel}</span></span></TableCell>
            <TableCell className="hidden min-w-0 lg:table-cell">{purchase.trackingNumber ? <span className="flex min-w-0 max-w-full items-center gap-2 text-sm" title={purchase.trackingNumber}><Truck className="size-4 shrink-0" /><span className="min-w-0 max-w-[8rem] truncate font-mono text-xs">{purchase.trackingNumber}</span></span> : <span className="text-muted-foreground">—</span>}</TableCell>
          </TableRow>
        })}</TableBody>
      </Table>
    </CardContent>}
  </Card>
}
