# Testing Guide

## Automated Checks

Run both checks before committing changes:

```bash
npm run lint
npm run build
```

## Manual Customer Booking Test

1. Run `npm run dev` and open `http://localhost:3000`.
2. Select a date between today and the end of next month.
3. Confirm all hourly slots for both demo outlets are shown.
4. Confirm booked slots are disabled and labelled.
5. Enter customer details and complete the simulated 20 USD booking.
6. Open the customer session and seller panel links from the confirmation page.

## Manual Seller Dashboard Test

1. Open `http://localhost:3000/seller`.
2. Check Overview, Bookings, Customers, and Sessions.
3. Confirm each table fits the dashboard content area and changes records through pagination.
4. Use a row action to open the seller or customer session view.
5. Use Book for customer to create a seller-side appointment.
6. In a seller session, add products, change quantities, remove a product, and close the session.

## Live Synchronization Test

1. Keep the customer session and seller session open in separate browser tabs.
2. Add or edit products in the seller panel.
3. Confirm the customer cart updates without manually refreshing.
4. Close the session and complete the simulated 65 percent payment from the customer page.

## Theme Test

Use the theme control in the customer header or seller dashboard header. Confirm Light, Dark, and System themes apply across the full page.
