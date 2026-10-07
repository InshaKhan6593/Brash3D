import { redirect } from "next/navigation"
import { LoginForm } from "@/components/login-form"
import { getStaffSession } from "@/lib/auth"
import { returnPathFor } from "@/lib/login-return"

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams
  const staff = await getStaffSession()
  if (staff) redirect(returnPathFor(staff.role, next))
  return <LoginForm next={typeof next === "string" ? next : undefined} />
}
