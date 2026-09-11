"use client"

import { FormEvent, useState } from "react"
import { LockKeyhole } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ModeToggle } from "@/components/mode-toggle"

export function LoginForm() {
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setSubmitting(true)
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      })
      const body = await response.json() as { error?: string; user?: { role: string } }
      if (!response.ok) throw new Error(body.error || "Unable to sign in")
      // Full document load rather than router.replace(): the session cookie was
      // only just set on this response, and a soft navigation can reuse the
      // router's pre-login entry for the destination and bounce straight back
      // here, which looks like the button doing nothing. `submitting` stays true
      // so the button is disabled while the browser navigates away.
      window.location.assign(body.user?.role === "local_team" ? "/local-team" : "/seller")
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to sign in")
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4"><ModeToggle /></div>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <span className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><LockKeyhole /></span>
          <CardTitle>Staff sign in</CardTitle>
          <CardDescription>Access the Brash3D operations panel.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="username" required /></div>
            <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" autoComplete="current-password" required /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" size="lg" disabled={submitting}>{submitting ? "Signing in..." : "Sign in"}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
