import { Badge } from "@/components/ui/badge"
import type { ConsolidatedBoxManifest } from "@/lib/types"
import { formatCurrency } from "@/lib/utils"

export function BoxManifest({ box, children }: { box: ConsolidatedBoxManifest; children?: React.ReactNode }) {
  return <details className="group rounded-md border p-3">
    <summary className="cursor-pointer list-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-semibold">{box.number}</p><p className="text-xs text-muted-foreground">{box.courier} · {box.trackingNumber}</p></div>
        <div className="flex flex-wrap gap-2"><Badge variant="secondary">{box.customerCount} customers</Badge><Badge variant="outline">{box.totalUnits} units</Badge></div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Open digital manifest</p>
    </summary>
    <div className="mt-3 space-y-3 border-t pt-3">
      {box.packages.map((item) => <div key={item.sessionId} className="rounded-md bg-muted p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><div><p className="font-medium">{item.customerName}</p><p className="font-mono text-xs">{item.labelCode}</p></div><p className="font-semibold">Balance {formatCurrency(item.remainingBalance)}</p></div>
        <p className="mt-2 text-xs text-muted-foreground">{item.phone} · {item.deliveryAddress}, {item.deliveryCity}</p>
        <div className="mt-2 space-y-1 border-t pt-2">{item.products.map((product, index) => <div key={`${item.sessionId}-${index}`} className="flex justify-between gap-3"><span>{product.quantity} × {product.name}</span><span>{formatCurrency(product.price * product.quantity)}</span></div>)}</div>
      </div>)}
      {children}
    </div>
  </details>
}
