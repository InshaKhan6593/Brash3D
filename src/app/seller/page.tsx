import { redirect } from "next/navigation"
import { SellerPanel } from "@/components/seller-panel"
import { requireStaff } from "@/lib/auth"
// Not from seller-panel.tsx: that module is "use client", and a server
// component calling into it throws at request time.
import { dashboardTabFrom } from "@/lib/dashboard-tabs"

export default async function SellerPage({ searchParams }: PageProps<"/seller">) {
  const staff = await requireStaff(["admin", "seller"])
  if (!staff) redirect("/login")
  const { sessionId, tab } = await searchParams
  return (
    <SellerPanel
      sessionId={typeof sessionId === "string" ? sessionId : null}
      tab={dashboardTabFrom(tab)}
      isAdmin={staff.role === "admin"}
    />
  )
}
