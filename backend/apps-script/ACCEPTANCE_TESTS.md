# IBMC Endowment Fund MVP Acceptance Tests

Record the tester, date, evidence link, and result for every case. Use fictional test donors and Paystack test mode until the board authorises production.

| ID | Test | Expected result |
| --- | --- | --- |
| SET 01 | Run `setupSystem` in a blank Sheet | All required sheets, headers, validation rules, menu items, Settings defaults, and Dashboard appear. |
| SET 02 | Run `setupSystem` again | Existing records remain intact and no duplicate settings are created. |
| SEC 01 | Inspect the public HTML and Sheet | Paystack secret key is absent from both. |
| SEC 02 | Attempt a trustee menu action from an email not in `TRUSTEE_EMAILS` | Action is rejected. |
| SEC 03 | Submit text beginning with `=` or `+` | Sheet stores it as text, not a formula. |
| DON 01 | Submit valid donor data with email | Donor ID is created and acknowledgement email is logged. |
| DON 02 | Submit again with the same email and an updated phone | No duplicate donor is created. Existing contacts remain unchanged; `CONTACT_REVIEW_REQUESTED` captures proposed changes for trustee verification. |
| DON 03 | Submit with neither email nor phone | Submission is rejected with a clear validation message. |
| DON 04 | Submit without consent | Submission is rejected. |
| PAY 01 | Start a valid NGN Paystack test donation | Contribution is `Pending Payment` and checkout opens. |
| PAY 02 | Complete the Paystack test payment | Server-side verification confirms status, amount, and currency; contribution becomes `Received`; receipt is issued. |
| PAY 03 | Return with an unknown or incomplete reference | No contribution is marked received. |
| PAY 04 | Verify the same successful transaction twice | Second verification is idempotent and does not duplicate the receipt or pledge allocation. |
| PAY 05 | Simulate a gateway amount or currency mismatch | Receipt is not issued and an audit exception is recorded. |
| MAN 01 | Submit an offline donation | Contribution is `Pending Verification`; no receipt is issued. |
| MAN 02 | Trustee confirms the record after bank reconciliation | Status becomes `Received`, a unique receipt is issued, and the action is audited. |
| PLG 01 | Submit a NGN 100,000 monthly pledge with NGN 30,000 installments | Schedule contains 30,000, 30,000, 30,000 and 10,000 installments. |
| PLG 02 | Create a pledge starting on 31 January | Later month-end dates clamp correctly rather than rolling into the next month. |
| PLG 03 | Use an end date too early to cover the pledge | Submission is rejected with a schedule error. |
| PLG 04 | Confirm a contribution linked to a pledge | Oldest unpaid installments are reduced first and pledge totals update. |
| PLG 05 | Fulfil the total pledge | Pledge becomes `Fulfilled`, outstanding is zero, and next due date clears. |
| REM 01 | Run reminders seven days before a due installment for an email-preferring donor | One email is sent and a reminder row is logged. |
| REM 02 | Run reminders again the same day | Duplicate upcoming reminder is not sent. |
| REM 03 | Run reminders for an overdue installment | Email repeats only after the configured overdue interval. |
| REM 04 | Run reminders for a WhatsApp-preferring donor | No email is sent; a manual follow-up row is created. |
| REM 05 | Fail an upcoming email, restore email service, and rerun | Failed attempt is logged without advancing Last Reminder At; the next run sends the reminder once. |
| REM 06 | Pause or cancel a pledge, or deactivate a donor, before a due installment | No reminder is sent or queued. |
| SEC 04 | Submit an email matching one donor and a phone matching another | Submission is rejected without changing either donor. |
| SEC 05 | Call runDailyReminders from a non-trustee account | Access is denied; the private scheduled handler remains available to the installed trigger. |
| WEB 01 | Leave appsScriptWebAppUrl empty or invalid | Website remains a local preview; secure-form links stay hidden. |
| WEB 02 | Configure the tested Apps Script /exec URL | Homepage contribution links and the pledge page open the configured form. No preview donor details appear in the URL. |
| OPS 03 | Reinstall daily reminders with Paystack reconciliation already installed | One daily reminder trigger exists; the payment reconciliation trigger is preserved. |
| AST 01 | Submit an asset offer | Status is `Pending Review`; acknowledgement does not claim acceptance or transfer. |
| AST 02 | Approve the selected asset | Status becomes `Accepted`; reviewer, time, and audit event are recorded. |
| SVC 01 | Submit and accept a service offer | Offer progresses from `Offered` to `Accepted` with an audit event. |
| REP 01 | Record NGN and USD activity | Dashboard displays each currency separately and never adds them together. |
| REP 02 | Add an investment-manager period row | Investment data stays separate from contribution receipts. |
| OPS 01 | Exhaust or disable automatic email | Submission remains recorded; failure or disabled state is auditable and manually actionable. |
| OPS 02 | Review Apps Script execution history after scheduled runs | No unresolved failures remain before launch. |
