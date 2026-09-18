/**
 * How many days a completed delivery stays on the Colombia panel.
 *
 * `envios.estado = 'entregado'` is terminal and nothing ever clears it, so
 * without a bound the delivery queue returns every order the business has ever
 * delivered -- each with all its product lines -- on a five-second poll,
 * growing for the life of the company.
 *
 * Outstanding work is never cut by this: only deliveries already handed over
 * age out, and they age out of a screen whose whole purpose is the work still
 * to do. The seller's own dashboard and the customer's order page both keep the
 * full history.
 *
 * It lives here rather than in the store because the panel states the window in
 * its own footer, and the store is `server-only`.
 */
export const DELIVERED_QUEUE_DAYS = 30
