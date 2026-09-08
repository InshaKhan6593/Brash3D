import { redirect } from "next/navigation"
import { LoginForm } from "@/components/login-form"
import { getStaffSession } from "@/lib/auth"

export default async function LoginPage() {
  const staff = await getStaffSession()
  if (staff) redirect(staff.role === "local_team" ? "/local-team" : "/seller")
  return <LoginForm />
}
