# Testing Guide

## Automated Checks

Run all checks before committing changes:

```bash
npm run lint
npm run build
npm audit --omit=dev
```

With the local development server running, execute the database-backed API smoke test:

```bash
npm run test:smoke
```

For local Stripe events, run `stripe login`, then:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Put the emitted `whsec_...` value directly in `.env.local`, restart Next.js, and use Stripe test cards. Never commit or paste Stripe secrets into chat.

## Manual Customer Booking Test

1. Run `npm run dev` and open `http://localhost:3000`.
2. Select a date between today and the end of next month.
3. Confirm all hourly Nike Sawgrass slots are shown.
4. Confirm booked slots are disabled and labelled.
5. Enter customer details and complete the 20 USD Stripe Test Mode Checkout.
6. Confirm the verified webhook changes the reservation from pending to confirmed.
7. Abandon another checkout and confirm the slot becomes available after 15 minutes.

## Manual Seller Dashboard Test

1. Open `http://localhost:3000/seller` and confirm it redirects to `/login` while signed out.
2. Sign in with a staff account created through `npm run auth:create-staff`.
3. Check Overview, Bookings, Customers, and Sessions.
4. Confirm each table fits the dashboard content area and changes records through pagination.
5. Use a row action to open the seller or secure customer session view.
6. Use Book for customer to create a seller-side appointment.
7. In a seller session, add products, change quantities, remove a product, and close the session.
8. Sign out and confirm the seller page and APIs are no longer accessible.

## Live Synchronization Test

1. Keep the customer session and seller session open in separate browser tabs.
2. Add or edit products in the seller panel.
3. Confirm the customer cart updates without manually refreshing.
4. Close the session and complete the 65 percent Stripe test payment from the customer page while `stripe listen` forwards webhooks.
5. Confirm the customer enters a Colombia city and complete delivery address before Checkout opens.
6. Create the individual shipment, attach it to a consolidated box, and verify its digital manifest.
7. Sign in as Colombia staff, receive the box, record the final payment, and confirm seller/customer status updates.

## Theme Test

Use the theme control in the customer header or seller dashboard header. Confirm Light, Dark, and System themes apply across the full page.
