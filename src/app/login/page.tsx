import { redirect } from "next/navigation"
import { LoginForm } from "@/components/login-form"
import { getStaffSession } from "@/lib/auth"

export default async function LoginPage() {
  if (await getStaffSession()) redirect("/seller")
  return <LoginForm />
}
