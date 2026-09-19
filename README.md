# IBMC Endowment Fund

A mobile-first website and pilot workflow for the Igbajo Baptist Medical Centre Endowment Fund.

## Repository structure

- `dist/` — deployable static website for Vercel.
- `backend/apps-script/` — Google Apps Script workflow for pledge registers, acknowledgements, reminders, trustee notifications, audit history, and Paystack reconciliation.
- `vercel.json` — configures Vercel to publish `dist/`.

## Deployment

Import this repository into Vercel. No build command is required; the included `vercel.json` publishes the `dist` directory.

For a local preview:

```powershell
python -m http.server 4173 --directory dist
```

Then open `http://localhost:4173`.

## Workflow status

The website at [ibmc-pink.vercel.app](https://ibmc-pink.vercel.app/) currently presents a pledge preview and does not transmit donor data. The full intake under `backend/apps-script/` supports cash donations, scheduled pledges, assets, and services. Deploy it as a Google Apps Script web app to accept submissions into the private Google Sheet.

After testing the Apps Script deployment, set `appsScriptWebAppUrl` in `dist/runtime-config.js` to its `https://script.google.com/macros/s/DEPLOYMENT_ID/exec` URL and redeploy Vercel. The homepage contribution links and pledge-page secure-form buttons will open that intake. A blank or invalid setting keeps the preview available. Donors enter their final details on the Google-hosted form; preview details are not passed in a URL. The Vercel website URL is not the Apps Script endpoint.

The test workspace uses safe defaults:

- automatic emails are disabled;
- Paystack is disabled;
- no scheduled triggers are installed;
- payment credentials belong in Apps Script Properties and must never be committed.

## Production checklist

1. Complete Google OAuth authorisation in the designated IBMC Workspace account.
2. Run the documented acceptance tests with fictional donor data.
3. Deploy the Apps Script web app and set its URL in `dist/runtime-config.js`.
4. Keep Paystack in test mode until payment verification, receipts, and reconciliation pass.
5. Enable automatic emails and scheduled triggers only after trustee approval.

## Verification

Run `npm test` with Node.js 20 or later. Tests use fictional in-memory records and do not send messages, charge payments, or write to Google Sheets. Deployed Google and Paystack checks are listed in `backend/apps-script/ACCEPTANCE_TESTS.md`.

