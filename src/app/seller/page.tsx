import { redirect } from "next/navigation"
import { SellerPanel } from "@/components/seller-panel"
import { requireStaff } from "@/lib/auth"
// Not from seller-panel.tsx: that module is "use client", and a server
// component calling into it throws at request time.
import { dashboardTabFrom } from "@/lib/dashboard-tabs"
import { loginUrlReturningTo } from "@/lib/login-return"

export default async function SellerPage({ searchParams }: PageProps<"/seller">) {
  const staff = await requireStaff(["admin", "seller"])
  const { sessionId, tab } = await searchParams
  if (!staff) {
    // Keep the session the link was for, so signing in lands on it -- the
    // seller's booking email links straight to a live session.
    const query = new URLSearchParams()
    if (typeof sessionId === "string") query.set("sessionId", sessionId)
    if (typeof tab === "string") query.set("tab", tab)
    redirect(loginUrlReturningTo(query.size ? `/seller?${query}` : "/seller"))
  }
  return (
    <SellerPanel
      sessionId={typeof sessionId === "string" ? sessionId : null}
      tab={dashboardTabFrom(tab)}
      isAdmin={staff.role === "admin"}
    />
  )
}
