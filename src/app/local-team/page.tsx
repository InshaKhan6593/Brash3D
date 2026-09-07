import { redirect } from "next/navigation"
import { LocalTeamPanel } from "@/components/local-team-panel"
import { requireStaff } from "@/lib/auth"

export default async function LocalTeamPage() {
  const staff = await requireStaff(["admin", "local_team"])
  if (!staff) redirect("/login")
  return <LocalTeamPanel />
}
