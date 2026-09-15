# IBMC Endowment Fund MVP

This package implements the immediate pilot requested in the client documents. Donors can register, make an immediate cash donation, make a scheduled cash pledge, offer an asset, or offer time and expertise. Trustees operate the system from a private Google Sheet. Google Apps Script handles validation, acknowledgements, reminders, Paystack payment initiation and verification, pledge balances, receipts, audit records, and a currency-separated dashboard.

The public intake uses an Apps Script web page instead of Google Forms. This keeps the form open to donors who do not have Google accounts and avoids the sign-in requirement attached to Google Forms file uploads. Supporting evidence is collected as a link or handled directly by a trustee.

## Files

- `Config.gs` defines sheets, columns, status values, and defaults.
- `Domain.gs` contains validation and installment-scheduling logic.
- `Repository.gs` contains Google Sheets persistence and audit helpers.
- `Setup.gs` creates the workbook, formats sheets, installs menus and triggers, and builds the dashboard.
- `Code.gs` serves the public form and records submissions.
- `PaymentGateway.gs` integrates Paystack and reconciles pending transactions.
- `Ledger.gs` allocates received donations to pledge installments.
- `Notifications.gs` sends acknowledgements and reminders or queues manual follow-up.
- `Index.html` is the public donor form.
- `Callback.html` reports Paystack verification results.
- `appsscript.json` declares the required Apps Script scopes and time zone.
- `tests/domain.test.js` tests the pure business rules with Node.js.

## Deployment

1. Create a dedicated Google Sheet owned by the hospital or its authorised project account. Prefer a managed Google Workspace account over a personal Gmail account.
2. Open **Extensions > Apps Script** from that Sheet.
3. Create files with the same names as this package and paste in their contents. Keep `.gs` files as script files and `.html` files as HTML files.
4. Replace the generated manifest with `appsscript.json`. In Apps Script project settings, enable the option to show the manifest file if necessary.
5. Run `setupSystem` once from the Apps Script editor. Review and grant the requested permissions. The setup creates and formats all required sheets.
6. Unhide the `Settings` sheet. Complete at least:

   - `CONTACT_EMAIL`
   - `CONTACT_PHONE`
   - `BANK_TRANSFER_INSTRUCTIONS`
   - `PRIVACY_NOTICE_URL`
   - `ALLOWED_CURRENCIES`
   - `PAYSTACK_ENABLED`

7. In **Project Settings > Script Properties**, add:

   - `SPREADSHEET_ID`: normally written automatically by `setupSystem`
   - `TRUSTEE_EMAILS`: comma-separated authorised trustee emails
   - `PAYSTACK_SECRET_KEY`: begin with a Paystack test secret key; never place this value in a sheet or HTML file
   - `WEB_APP_URL`: add this after the first web-app deployment

8. Deploy as a web app:

   - Execute as: **Me**
   - Who has access: the public access option approved by the hospital

9. Copy the deployment URL into the `WEB_APP_URL` Script Property, then create a new deployment version.
10. Run `installAutomation`. It creates a daily reminder trigger and a six-hour Paystack reconciliation trigger.
11. Share the Google Sheet only with approved trustees and finance staff. Donors receive only the web-app URL.

## Paystack activation

Keep `PAYSTACK_ENABLED` set to `FALSE` until the hospital has completed Paystack onboarding and the test flow has passed. Then:

1. Configure a Paystack test secret key.
2. Submit a small NGN test donation from the public form.
3. Complete checkout and confirm that the callback marks the contribution `Received`, issues a receipt, and updates the dashboard.
4. Test an incomplete payment and confirm that it remains `Pending Payment`.
5. Test a payment linked to a pledge and confirm that the oldest unpaid installment is updated first.
6. Complete Paystack production activation and switch to the live secret key.
7. Enable USD only after international payments and the required USD settlement account have been approved.

The Apps Script web-app request object does not provide the Paystack signature header needed for robust webhook verification. This MVP therefore verifies each trusted callback with Paystack's transaction API and polls unresolved payments every six hours. Move webhook processing to a small server or cloud function before high-volume use.

## Trustee workflow

- **Manual cash or bank transfer:** select its row in `Contributions`, verify evidence against the bank record, then use **IBMC Endowment > Confirm selected manual receipt**.
- **Paystack payment:** callbacks and scheduled reconciliation verify payments. A trustee can also select a row and choose **Verify selected Paystack payment**.
- **Asset:** complete valuation, ownership, conflict, and gift-acceptance checks before selecting the asset row and choosing **Approve selected asset**. `Accepted` still does not mean title has transferred; use `Transfer In Progress` and `Transferred` for that lifecycle.
- **Service:** confirm that the offer matches an approved need before accepting and scheduling it.
- **WhatsApp or phone preference:** reminders appear in `Reminders` as `Queued for manual follow-up`. The MVP does not claim free automated WhatsApp messaging.
- **Investment reporting:** the appointed manager or trustee records period-end values in `Investments`. Donation receipts and investment values remain separate ledgers.

## Controls before launch

- Publish a privacy notice and define retention, access, correction, deletion, and breach-response procedures.
- Approve a gift-acceptance policy for restricted gifts, real estate, securities, equipment, and services.
- Approve the endowment instrument, Investment Policy Statement, spending rule, conflict policy, delegations, signatories, and audit process.
- Reconcile every payment against bank or gateway records. Never mark a donation received from a screenshot alone.
- Keep NGN and USD totals separate unless trustees approve an exchange-rate source and valuation date.
- Back up the Sheet regularly and review the `AuditLog` and Apps Script execution history.
- Keep the included honeypot and per-contact submission throttle enabled; review the registers for abuse during a public campaign.
- Monitor Google Apps Script email and runtime quotas. Quota exhaustion must create an operational alert and a manual follow-up list.

## Local verification

Run the included domain tests with Node.js:

```powershell
node tests/domain.test.js
node tests/ledger.test.js
node tests/syntax.test.js
node tests/static_integration.test.js
```

The tests cover input normalisation, formula-injection protection, schedule generation, date clamping, amount conversion, pledge status calculations, entry-point wiring, HTML field references, manifest scopes, and accidental secret inclusion. Google service calls and Paystack calls require a deployed Apps Script test environment and a Paystack test key.

## Pilot exit criteria

The pilot is ready for controlled launch when all tests in `ACCEPTANCE_TESTS.md` pass, the client inputs in `CLIENT_REVIEW_AND_EXECUTION_PLAN.md` are supplied, trustees are trained, and the board-approved governance documents are in place.
