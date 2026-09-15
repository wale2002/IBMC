# IBMC Endowment Fund

A corporate, mobile-first website and pilot workflow for the International Breast and Maternal Cancer Centre Endowment Fund.

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

The website currently presents a safe pledge preview and does not transmit donor data. The Apps Script workflow is maintained separately under `backend/apps-script/` and must be deployed as a Google Apps Script web app before the public form can submit into Google Sheets.

The test workspace uses safe defaults:

- automatic emails are disabled;
- Paystack is disabled;
- no scheduled triggers are installed;
- payment credentials belong in Apps Script Properties and must never be committed.

## Production checklist

1. Complete Google OAuth authorisation in the designated IBMC Workspace account.
2. Run the documented acceptance tests with fictional donor data.
3. Deploy the Apps Script web app and connect its endpoint to the frontend.
4. Keep Paystack in test mode until payment verification, receipts, and reconciliation pass.
5. Enable automatic emails and scheduled triggers only after trustee approval.

