"use client"

import type { ReactNode } from "react"
import { CheckCircle2, CreditCard, Package, ReceiptText, Truck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CustomerPurchaseHistory, PurchaseHistoryItem } from "@/lib/types"
import { cn, formatCurrency } from "@/lib/utils"

function purchaseStatus(purchase: PurchaseHistoryItem): { label: string; className: string; icon: ReactNode } {
  if (purchase.shipmentStatus === "entregado") return { label: "Delivered", className: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300", icon: <CheckCircle2 /> }
  if (purchase.shipmentStatus === "en_transito" || purchase.shipmentStatus === "en_aduanas") return { label: purchase.shipmentStatus === "en_aduanas" ? "In customs" : "Shipped", className: "bg-violet-100 text-violet-700 hover:bg-violet-100 dark:bg-violet-950 dark:text-violet-300", icon: <Truck /> }
  if (purchase.shipmentStatus === "preparacion" || purchase.status === "en_progreso") return { label: "Processing", className: "bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300", icon: <Package /> }
  if (purchase.shipmentStatus === "devuelto") return { label: "Returned", className: "bg-orange-100 text-orange-700 hover:bg-orange-100 dark:bg-orange-950 dark:text-orange-300", icon: <ReceiptText /> }
  return { label: purchase.status === "cancelada" ? "Cancelled" : "Completed", className: "bg-secondary text-secondary-foreground", icon: <CheckCircle2 /> }
}

function PurchaseStatusBadge({ purchase }: { purchase: PurchaseHistoryItem }) {
  const status = purchaseStatus(purchase)
  return <Badge variant="outline" className={cn("max-w-full gap-1 overflow-hidden text-ellipsis border-transparent", status.className)}>{status.icon}<span className="truncate">{status.label}</span></Badge>
}

export function PurchaseHistoryTable({ history }: { history: CustomerPurchaseHistory }) {
  const inTransitCount = history.purchases.filter((purchase) => purchase.shipmentStatus === "en_transito" || purchase.shipmentStatus === "en_aduanas").length
  const totalSpent = history.purchases.reduce((sum, purchase) => sum + purchase.total, 0)

  return <Card className="overflow-hidden">
    <CardHeader className="flex-row items-center justify-between space-y-0 border-b px-4 py-4 sm:px-5">
      <div>
        <CardTitle className="text-lg">Order history</CardTitle>
        <CardDescription>{history.purchases.length} order{history.purchases.length === 1 ? "" : "s"} · {formatCurrency(totalSpent)} total spent</CardDescription>
      </div>
      {inTransitCount > 0 && <Badge variant="outline" className="gap-1"><Truck />{inTransitCount} in transit</Badge>}
    </CardHeader>
    {history.purchases.length === 0 ? <CardContent className="flex min-h-36 items-center justify-center p-6 text-center text-sm text-muted-foreground">Your completed orders will appear here after your first live-shopping session.</CardContent> : <CardContent className="p-0">
      <Table className="w-full table-fixed">
        <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-[27%] sm:w-[20%] lg:w-[17%]">Order</TableHead><TableHead className="w-[34%] sm:w-[29%] lg:w-[25%]">Items</TableHead><TableHead className="w-[24%] sm:w-[18%] lg:w-[17%]">Status</TableHead><TableHead className="w-[15%] text-right sm:w-[14%] lg:w-[13%]">Total</TableHead><TableHead className="hidden md:table-cell md:w-[13%] lg:w-[13%]">Payment</TableHead><TableHead className="hidden lg:table-cell lg:w-[15%]">Tracking</TableHead></TableRow></TableHeader>
        <TableBody>{history.purchases.map((purchase) => {
          const firstProduct = purchase.products[0]
          const extraProducts = Math.max(purchase.products.length - 1, 0)
          const itemIcons = purchase.products.length ? purchase.products.slice(0, 2) : [{ id: `${purchase.sessionId}-empty` }]
          return <TableRow key={purchase.sessionId}>
            <TableCell className="whitespace-nowrap"><p className="font-mono text-sm font-medium">ORD-{purchase.sessionId.slice(-8).toUpperCase()}</p><p className="text-xs text-muted-foreground">{new Date(purchase.bookedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p></TableCell>
            <TableCell className="min-w-0"><div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <div className="flex shrink-0 -space-x-1.5">{itemIcons.map((product) => <span key={product.id} className="flex size-8 items-center justify-center rounded-full border bg-muted text-muted-foreground ring-2 ring-background"><Package className="size-3.5" /></span>)}</div>
              <div className="min-w-0"><p className="truncate font-medium">{firstProduct?.nombre || "No product details"}</p><p className="text-xs text-muted-foreground">{extraProducts > 0 ? `+${extraProducts} more item${extraProducts === 1 ? "" : "s"}` : firstProduct ? `Qty ${firstProduct.cantidad}` : "Details unavailable"}</p></div>
            </div></TableCell>
            <TableCell className="min-w-0"><PurchaseStatusBadge purchase={purchase} /></TableCell>
            <TableCell className="whitespace-nowrap text-right font-semibold">{formatCurrency(purchase.total)}</TableCell>
            <TableCell className="hidden whitespace-nowrap md:table-cell"><span className="inline-flex items-center gap-2 text-sm" title={purchase.paymentStatus === "paid" ? "Paid" : purchase.paymentStatus === "partial" ? "Partial" : "Pending"}><CreditCard className="size-4 shrink-0 text-muted-foreground" /><span className="hidden xl:inline">{purchase.paymentStatus === "paid" ? "Paid" : purchase.paymentStatus === "partial" ? "Partial" : "Pending"}</span></span></TableCell>
            <TableCell className="hidden min-w-0 lg:table-cell">{purchase.trackingNumber ? <span className="flex min-w-0 max-w-full items-center gap-2 text-sm" title={purchase.trackingNumber}><Truck className="size-4 shrink-0" /><span className="min-w-0 max-w-[8rem] truncate font-mono text-xs">{purchase.trackingNumber}</span></span> : <span className="text-muted-foreground">—</span>}</TableCell>
          </TableRow>
        })}</TableBody>
      </Table>
    </CardContent>}
  </Card>
}
