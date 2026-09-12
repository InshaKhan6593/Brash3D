/**
 * Contract smoke test for the error responses of the cart, payment-stage and
 * Colombia delivery endpoints.
 *
 * The headline assertion is the money guard:
 * `confirmDeliveryWithoutBalance` must refuse an order that still owes money.
 * That check is the entire reason the endpoint is separate from the ordinary
 * delivery confirmation, and a regression in it would close orders while a
 * balance was outstanding. It is asserted in both directions — 409 for an order
 * with a balance, 200 for one paid 100% up front.
 *
 * Two further behaviours it guards were wrong until they were fixed, and neither
 * is reachable from the app's own UI, so nothing else would catch a regression:
 *
 *   1. Editing the cart of a session that exists but is in the wrong state
 *      answered `404 Session not found`. The session existed and the same
 *      caller could read it, so the message was simply false. It now answers
 *      409 with the reason, matching what `start` already did.
 *
 *   2. Asking for a final-payment checkout on an order paid 100% up front
 *      answered "No pudimos calcular el monto a pagar. Contacta al equipo de
 *      Brash3D." and logged at error level — a support-desk message and a false
 *      alert for a supported configuration. It now says the balance is settled.
 *
 * The 404s that are deliberate are asserted too, so a future fix cannot loosen
 * them by accident: an unknown session stays 404, and a session belonging to
 * another seller stays 404 rather than 403.
 *
 * Usage, with the dev server running:
 *   SEED_ADMIN_PASSWORD='...' SEED_SELLER_PASSWORD='...' \
 *     node scripts/session-contract-smoke-test.mjs
 *
 * SEED_SELLER_PASSWORD is optional; without it the two authorization-boundary
 * checks that need a seller account are skipped.
 *
 * Almost everything here is read-only: the probe product it adds is removed
 * again. The one exception is the final check, which confirms delivery of a
 * fully prepaid order — a one-way transition that consumes that fixture. It runs
 * last and skips cleanly when no such order is left, so the script still exits 0
 * on a repeat run; re-run scripts/seed-test-fixtures.mjs to restore it.
 */


const BASE = process.env.BASE_URL || "http://localhost:3000"
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@brash3d.com"
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD
const SELLER_EMAIL = process.env.SEED_SELLER_EMAIL || "maria@brash3d.com"
const SELLER_PASSWORD = process.env.SEED_SELLER_PASSWORD

if (!ADMIN_PASSWORD) {
  console.error("Set SEED_ADMIN_PASSWORD (and optionally SEED_SELLER_PASSWORD).")
  process.exit(1)
}

const MISSING_UUID = "00000000-0000-4000-8000-000000000999"
let failures = 0
let checks = 0

function check(label, actual, expected) {
  checks += 1
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`)
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`)
}

async function signIn(email, password) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) throw new Error(`sign-in failed for ${email}: ${response.status} ${await response.text()}`)
  const cookie = (response.headers.getSetCookie?.() || [])
    .find((entry) => entry.startsWith("brash3d_staff_session="))
  if (!cookie) throw new Error(`no session cookie returned for ${email}`)
  return cookie.split(";")[0]
}

async function post(cookie, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, Cookie: cookie },
    body: JSON.stringify(body),
  })
  let parsed
  try { parsed = await response.json() } catch { parsed = {} }
  return { status: response.status, body: parsed }
}

const sessionAction = (cookie, action, data) => post(cookie, "/api/sessions", { action, ...data })

async function main() {
  const admin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD)

  const listed = await fetch(`${BASE}/api/sessions`, { headers: { Cookie: admin } })
  const { sessions } = await listed.json()

  const notStarted = sessions.find((s) => s.estado === "en_progreso" && !s.startedAt)
  const closedUnpaid = sessions.find((s) => s.estado === "completada" && s.total > 0 && s.montoPagadoInicial === 0)
  const prepaid = sessions.find((s) => s.porcentajeInicial >= 100 && s.montoPagadoInicial > 0
    && s.montoPagadoFinal === 0 && s.envio?.estado === "recibido_equipo_local")
  const balanceDue = sessions.find((s) => s.porcentajeInicial < 100 && s.montoPagadoInicial > 0
    && s.montoPagadoFinal === 0 && s.envio?.estado === "recibido_equipo_local")

  let started = sessions.find((s) => s.estado === "en_progreso" && s.startedAt)
  if (!started && notStarted) {
    const startResult = await sessionAction(admin, "start", { sessionId: notStarted.id })
    if (startResult.status === 200) started = startResult.body.session
  }

  const missing = []
  if (!notStarted) missing.push("an en_progreso session that has not started")
  if (!closedUnpaid) missing.push("a completada session with total > 0 and nothing paid")
  if (!started) missing.push("a started en_progreso session")
  if (missing.length) {
    console.error("Missing fixtures:\n  - " + missing.join("\n  - "))
    console.error("\nRun: SEED_ADMIN_PASSWORD='...' node scripts/seed-test-fixtures.mjs")
    process.exit(1)
  }

  console.log("\nCart edits on a session in the wrong state answer 409, not a false 404")
  const beforeStart = await sessionAction(admin, "addProduct", {
    sessionId: notStarted.id, nombre: "Contract probe", precio: 10,
  })
  check("addProduct on a session that has not started -> 409", beforeStart.status, 409)
  check("  with the reason", beforeStart.body.error, "Start the session before changing the cart")

  const onClosed = await sessionAction(admin, "addProduct", {
    sessionId: closedUnpaid.id, nombre: "Contract probe", precio: 10,
  })
  check("addProduct on a closed session -> 409", onClosed.status, 409)
  check("  with the reason", onClosed.body.error, "This session is closed and its cart can no longer be changed")

  console.log("\nA session that is genuinely editable still works")
  const added = await sessionAction(admin, "addProduct", {
    sessionId: started.id, nombre: "Contract probe", precio: 10, cantidad: 1,
  })
  check("addProduct on a started session -> 200", added.status, 200)
  const product = added.body.session?.productos?.find((item) => item.nombre === "Contract probe")
  check("  the product is in the cart", Boolean(product), true)

  if (product) {
    const up = await sessionAction(admin, "updateQuantity", { sessionId: started.id, productId: product.id, delta: 1 })
    check("updateQuantity delta 1 -> 200", up.status, 200)
    const bad = await sessionAction(admin, "updateQuantity", { sessionId: started.id, productId: product.id, delta: 2 })
    check("updateQuantity delta 2 -> 400", bad.status, 400)
    check("  with the reason", bad.body.error, "Quantity change must be 1 or -1")
  }

  console.log("\nA bad product id is reported as a bad product, not a missing session")
  const badProduct = await sessionAction(admin, "removeProduct", { sessionId: started.id, productId: MISSING_UUID })
  check("removeProduct with an unknown productId -> 404", badProduct.status, 404)
  check("  naming the product, not the session", badProduct.body.error, "Product not found in this session")

  console.log("\nThe deliberate 404s are unchanged")
  const unknownSession = await sessionAction(admin, "addProduct", {
    sessionId: MISSING_UUID, nombre: "Contract probe", precio: 10,
  })
  check("addProduct on an unknown session -> 404", unknownSession.status, 404)
  check("  with the generic message", unknownSession.body.error, "Session not found")

  const badAction = await sessionAction(admin, "frobnicate", { sessionId: started.id })
  check("an unknown action -> 400", badAction.status, 400)
  check("  with the reason", badAction.body.error, "Invalid action")

  const badDelivery = await sessionAction(admin, "updateDeliveryStatus", {
    sessionId: started.id, status: "en_transito",
  })
  check("updateDeliveryStatus to a non-initial step -> 400", badDelivery.status, 400)

  if (SELLER_PASSWORD) {
    const seller = await signIn(SELLER_EMAIL, SELLER_PASSWORD)
    const reopen = await sessionAction(seller, "reopenForCorrection", { sessionId: closedUnpaid.id })
    check("a seller reopening a closed session -> 403", reopen.status, 403)
    check("  with the reason", reopen.body.error, "Only an admin can reopen a closed session")
  } else {
    console.log("\n  (set SEED_SELLER_PASSWORD to also check the seller authorization boundary)")
  }

  console.log("\nA fully prepaid order is told its balance is settled, not that the amount failed to compute")
  if (prepaid) {
    const result = await post(admin, "/api/payments/checkout", { sessionId: prepaid.id, stage: "final" })
    check("final checkout on a 100% prepaid order -> 409", result.status, 409)
    check("  with the settled-balance message", result.body.error,
      "Este pedido ya fue pagado en su totalidad. Confirma la entrega sin cobro pendiente.")
  } else {
    console.log("  SKIP  no 100% prepaid order awaiting delivery; run the fixture seeder")
  }

  if (balanceDue) {
    const result = await post(admin, "/api/payments/checkout", { sessionId: balanceDue.id, stage: "final" })
    check("final checkout on an order that still owes money -> 200", result.status, 200)
    check("  returning a Stripe checkout", String(result.body.checkoutUrl || "").startsWith("https://checkout.stripe.com"), true)
  } else {
    console.log("  SKIP  no order with an outstanding balance; run the fixture seeder")
  }

  console.log("\nDelivery cannot be closed while money is still owed")
  if (balanceDue) {
    const guarded = await post(admin, "/api/local-team", {
      action: "confirmDeliveryWithoutBalance", sessionId: balanceDue.id,
    })
    check("confirmDeliveryWithoutBalance on an order that still owes money -> 409", guarded.status, 409)
    check("  with the reason", guarded.body.error, "This delivery still has a balance to collect")
  } else {
    console.log("  SKIP  no order with an outstanding balance; run the fixture seeder")
  }

  const badMethod = await post(admin, "/api/local-team", {
    action: "recordOfflinePayment", sessionId: balanceDue?.id || MISSING_UUID, method: "bitcoin",
  })
  check("recordOfflinePayment with an unsupported method -> 400", badMethod.status, 400)
  check("  with the reason", badMethod.body.error, "Invalid payment method")

  const badBox = await post(admin, "/api/local-team", { action: "receiveBox", boxId: MISSING_UUID })
  check("receiveBox on a box that is not awaiting receipt -> 409", badBox.status, 409)

  const unknownLocalAction = await post(admin, "/api/local-team", { action: "frobnicate" })
  check("an unknown local-team action -> 400", unknownLocalAction.status, 400)

  if (SELLER_PASSWORD) {
    const seller = await signIn(SELLER_EMAIL, SELLER_PASSWORD)
    const forbidden = await fetch(`${BASE}/api/local-team`, { headers: { Cookie: seller } })
    check("a seller reading the Colombia panel -> 401", forbidden.status, 401)
  }

  if (product) {
    await sessionAction(admin, "removeProduct", { sessionId: started.id, productId: product.id })
    console.log("\nCleaned up the probe product.")
  }

  // Last, and only when a fixture exists: this one is a one-way transition that
  // marks the shipment delivered, so it consumes the prepaid order it runs
  // against. Re-seed before expecting it again.
  console.log("\nA fully prepaid delivery can be closed with no collection (consumes the fixture)")
  if (prepaid) {
    const confirmed = await post(admin, "/api/local-team", {
      action: "confirmDeliveryWithoutBalance", sessionId: prepaid.id,
    })
    check("confirmDeliveryWithoutBalance on a 100% prepaid order -> 200", confirmed.status, 200)
    check("  reporting success", confirmed.body.success, true)
    console.log(`  (order ${prepaid.id} is now delivered; re-run the seeder to restore this fixture)`)
  } else {
    console.log("  SKIP  no 100% prepaid order awaiting delivery; run the fixture seeder")
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`)
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error("\nContract smoke test failed to run:", error.message)
  process.exit(1)
})
