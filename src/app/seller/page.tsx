import { redirect } from "next/navigation"
import { SellerPanel } from "@/components/seller-panel"
import { requireStaff } from "@/lib/auth"

export default async function SellerPage({ searchParams }: PageProps<"/seller">) {
  const staff = await requireStaff(["admin", "seller"])
  if (!staff) redirect("/login")
  const { sessionId } = await searchParams
  return <SellerPanel sessionId={typeof sessionId === "string" ? sessionId : null} />
}
