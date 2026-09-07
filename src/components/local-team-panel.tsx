"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Clipboard, LogOut, PackageCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ModeToggle } from "@/components/mode-toggle"
import { BoxManifest } from "@/components/box-manifest"
import type { ConsolidatedBoxManifest, SesionCompra } from "@/lib/types"
import { formatCurrency } from "@/lib/utils"

export function LocalTeamPanel() {
  const router = useRouter()
  const [deliveries, setDeliveries] = useState<SesionCompra[]>([])
  const [boxes, setBoxes] = useState<ConsolidatedBoxManifest[]>([])
  const [message, setMessage] = useState("")

  const refresh = useCallback(async () => {
    const response = await fetch("/api/local-team", { cache: "no-store" })
    if (!response.ok) return
    const data = await response.json() as { deliveries: SesionCompra[]; boxes: ConsolidatedBoxManifest[] }
    setDeliveries(data.deliveries)
    setBoxes(data.boxes)
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

  async function finalStripe(sessionId: string) {
    const response = await fetch("/api/payments/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, stage: "35" }) })
    const result = await response.json() as { checkoutUrl?: string; error?: string }
    if (!response.ok || !result.checkoutUrl) { setMessage(result.error || "Unable to create payment link"); return }
    await navigator.clipboard.writeText(result.checkoutUrl)
    setMessage("Secure 35% Stripe payment link copied. Send it to the customer through WhatsApp.")
  }

  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh() }

  return <div className="min-h-screen bg-muted/30">
    <header className="border-b bg-background"><div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4"><div><p className="text-sm text-muted-foreground">Brash3D SAS Colombia</p><h1 className="text-2xl font-bold">Local delivery operations</h1></div><div className="flex gap-2"><ModeToggle /><Button variant="outline" onClick={() => void logout()}><LogOut />Sign out</Button></div></div></header>
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      {message && <Card><CardContent className="py-3 text-sm">{message}</CardContent></Card>}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card><CardHeader><CardTitle>Customer deliveries</CardTitle><CardDescription>Receive packages, collect the final balance, and confirm delivery.</CardDescription></CardHeader><CardContent className="space-y-3">{deliveries.map((item) => <div key={item.id} className="rounded-md border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{item.cliente.nombre}</p><p className="text-sm text-muted-foreground">{item.cliente.ciudad} · {item.productos.length} products</p></div><div className="text-right"><p className="font-bold">{formatCurrency(item.total * .35 - item.montoPagado35)}</p><Badge variant="secondary">{item.envio?.estado.replaceAll("_", " ") || "Seller shipment pending"}</Badge></div></div>{item.envio?.estado === "recibido_equipo_local" && item.montoPagado35 === 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2"><Button onClick={() => void finalStripe(item.id)}><Clipboard />Copy Stripe payment link</Button><Button variant="outline" onClick={() => void action({ action: "recordOfflinePayment", sessionId: item.id, method: "efectivo" })}>Cash received</Button><Button variant="ghost" className="sm:col-span-2" onClick={() => void action({ action: "recordOfflinePayment", sessionId: item.id, method: "transferencia" })}>Bank transfer only if necessary</Button></div>}{item.envio?.estado === "entregado" && <p className="mt-3 flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="size-4" />Delivered and final payment recorded</p>}</div>)}</CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><PackageCheck />Incoming consolidated boxes</CardTitle><CardDescription>Confirm physical receipt, then use the manifest to sort each labelled customer package.</CardDescription></CardHeader><CardContent className="space-y-3">{boxes.length === 0 && <p className="text-sm text-muted-foreground">No boxes have been dispatched to Colombia.</p>}{boxes.map((box) => <BoxManifest key={box.id} box={box}>{box.status === "enviada" ? <Button className="w-full" size="sm" onClick={() => void action({ action: "receiveBox", boxId: box.id })}>Confirm box received</Button> : <Badge>Received by local team</Badge>}</BoxManifest>)}</CardContent></Card>
      </div>
    </main>
  </div>
}
