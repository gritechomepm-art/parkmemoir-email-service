# Live-mail fix QA — PDF attachment and Double Opt-in (2026-11-09)

## Actual evidence and scope

The account showed two successful `POST /emails` API requests at the provider, covering the one-time plan and the DOI confirmation email. No associated `GET /contacts`, `POST /contacts`, Topic PATCH or Segment POST was visible. Thus, the failed human confirmation likely occurred **before** the provider contact stage; without Cloudflare request status or the D1 row we cannot conclusively identify the specific cause.

This PR only changes the independent `parkmemoir-email` Worker. No public website deploy, DNS modification, schema migration or marketing Broadcast. Production keeps the old Worker version until a separately authorized code deployment.

## What changes after deploying this approved PR

1. One-time trip-plan email includes a genuine `PARKMEMOIR_Trip_and_Power_Plan.pdf` attachment. It is generated from validated plan inputs in the Worker, without R2, file uploads, new secrets, npm dependencies, browser rendering or Cloudflare paid products. It is a **printable trip and power summary**, not an exact reproduction of the public site's web-print document.
2. Email no longer claims that a legacy `?plan=...` URL will load and print the saved plan. The attached PDF works offline.
3. The confirmation form accepts email in-app browser POSTs that omit Origin, while blocking explicit foreign origins and cross-site fetches. The user must still open the email and click the Confirm button; token is 256-bit, unguessable, hashed in D1, single-use and expires after 48h.
4. Failed confirmations log only `DOI_CONFIRM_FAILED:<stage>` without email/token/request body. Non-PII stages include `consent_lookup`, `contact_lookup`, `contact_create`, `topic_opt_in`, `segment_add`, `consent_commit` and `consent_rollback`.

## Before deploying (owner)

- Verify PR #3 Source CI PASS on latest head. Approve and merge PR #3.
- Backup/record existing Cloudflare `parkmemoir-email` deployed Version ID.
- Copy complete `worker.mjs` **from main after merge** and paste into Cloudflare Worker Edit Code; deploy ONLY `parkmemoir-email`. Do not touch public `parkmemoir-public-p0` or the two verified sender-domain DNS records.
- Confirm `https://email.parkmemoir.com/health` continues to return HTTP 200 configured.

## Test plan (same browser smoke-test snippet; no new website feature flag)

1. Use the existing authorized test inbox and fresh Turnstile token; send a new one-time plan. Check `HTTP 200`, Resend delivery status, and actual email with the `.pdf` file. Open the attachment and inspect park/stay/month/devices/risks. Confirm no old print link.
2. Do **not** expect the existing winter website to acquire a send-mail button; that requires a separate public-site PR.
3. Attempt to confirm the **existing DOI email link** first, provided it is less than 48 hours old. Opening the GET confirmation page alone must not subscribe; click its confirmation button. If the current link fails with 410, inspect D1 (below) and request a new email. Rapid duplicate signup intentionally does not issue another email within one hour.
4. Check Cloudflare D1 Console using only non-personal fields:

```sql
SELECT status,
       CASE WHEN confirmation_sent_at IS NULL THEN 'no' ELSE 'yes' END AS confirmation_email_recorded,
       datetime(expires_at,'unixepoch') AS expires_utc,
       datetime('now') AS now_utc
FROM pm_seasonal_consent
ORDER BY updated_at DESC
LIMIT 3;
```

Expected before POST is `status=pending`, `confirmation_email_recorded=yes` and `expires_utc` later than `now_utc`. Expected after successful POST is `confirmed`. Never share the raw token or recipient email.
5. Check Resend > Contacts: confirmed account appears in **PARKMEMOIR — Confirmed Seasonal Updates** Segment, with Seasonal Topic = `opt_in`. Transactional plan-only recipient must NOT become a marketing contact.
6. If confirmation fails, view Cloudflare Worker Observability logs for non-PII `DOI_CONFIRM_FAILED:<stage>` and report only the stage string and HTTP status, no addresses or secrets. No provider Contact logs after clicking means trouble still occurs before the Contact stage.
7. Do not start marketing broadcasts until a separate unsubscribe/consent reconciliation test and privacy check are approved.

## Version and rollback

`SOURCE_CI_PASS` != `WORKER_DEPLOYED` != `LIVE_EMAIL_QA_PASS`. Preserve the previous Cloudflare Worker Version ID; if tests fail, roll back **only** `parkmemoir-email` to the previous version, record the rollback deployment, and retain D1 for investigation. Do not deploy the public website.
