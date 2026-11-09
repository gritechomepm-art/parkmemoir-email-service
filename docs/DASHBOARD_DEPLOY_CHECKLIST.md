# Release runbook — Cloudflare Dashboard (browser-only path)

**Scope:** ONLY the existing independent `parkmemoir-email` Worker; NEVER `parkmemoir-public-p0`. No changes to `parkmemoir.com` public UI or Digital Companion. This guide does **not** authorize deployment.

**Current state (2026-11-09):**
- Resend sender `mail.parkmemoir.com` Verified and dedicated Sending/Contacts API keys exist.
- Owner reports `parkmemoir-email` starter Worker exists, with `SUBSCRIBERS` D1 binding, four Worker secrets, and three plaintext vars.
- Owner reports `parkmemoir-email-consent` D1 has two tables and three indexes; Turnstile widget exists.
- **Cannot inspect Cloudflare dashboard secret values or D1 bindings through current connector.** Owner must verify those entries on-screen.
- GitHub PR #1 remains Draft; source-only CI is not deployment evidence.

## Preflight checklist (no code deployment)

1. Open https://dash.cloudflare.com/ > Workers & Pages > **parkmemoir-email** (verify exact name).
2. Settings > Bindings: `SUBSCRIBERS` must be D1 database `parkmemoir-email-consent` (NOT the public Digital Companion D1).
3. Settings > Variables and Secrets: verify the **names and types**, not the hidden values:

| Name | Type | Required value |
| --- | --- | --- |
| `EMAIL_FROM` | Text | `PARKMEMOIR <plans@mail.parkmemoir.com>` |
| `SEASONAL_SEGMENT_ID` | Text | `783397ab-e9c4-45af-926d-21c42f4092b8` |
| `SEASONAL_TOPIC_ID` | Text | `72ca65ad-4061-4b82-b66e-feb54721075a` |
| `RESEND_API_KEY` | **Secret** | Sending access scoped to sender domain |
| `RESEND_CONTACTS_API_KEY` | **Secret** | Separate Contacts/Topic/Segment management key |
| `TURNSTILE_SECRET_KEY` | **Secret** | Turnstile secret (not public Site Key) |
| `RATE_HASH_SECRET` | **Secret** | Fresh random value (recommended ≥32 bytes) |

4. D1 Console: the consent and rate tables plus three named indexes exist; no need to recreate them.
5. Leave existing Worker custom domain unbound, site email feature flags disabled, and Resend Broadcasts disabled.
6. Confirm [PR #1](https://github.com/gritechomepm-art/parkmemoir-email-service/pull/1) latest head has **Source CI PASS**, owner reviews and expressly approves its merge. PR #2 separately contains earlier setup documents and may require conflict reconciliation after PR #1 merges.

## Code deployment — only after explicit owner approval

**Simplest browser-only method**, using the existing Worker and its current D1/secret bindings:

1. Merge the reviewed PR #1 into `main` ONLY with owner approval. Open `worker.mjs` on `main`, select **Raw**, and copy the entire file.
2. Cloudflare > Workers & Pages > **parkmemoir-email** > **Edit code**. Replace the initial Hello World JavaScript with the exact `worker.mjs` source. Verify the editor uses **ES modules**, preserving the exported default `fetch` and `scheduled` handlers. No package installation is required for this source file.
3. Save/**Deploy** the isolated Worker. Record its Cloudflare Version ID and deployment information. This is a **real deployment**; do not click without owner approval. Secrets in the dashboard should remain bound; verify after deploy.
4. Cloudflare Worker **Settings > Domains & Routes**: add Custom Domain `email.parkmemoir.com` pointing ONLY to `parkmemoir-email`. Confirm it is distinct from sender `mail.parkmemoir.com`. Do not add a route matching `parkmemoir.com/*`.
5. Worker Settings > Triggers / Cron: add `0 6 * * *` UTC for pending consent/rate cleanup. Record Cron configuration.
6. After TLS and custom domain are active, open `https://email.parkmemoir.com/health` in a browser. Expected:
   - HTTP 200: `{"ok":true,"service":"parkmemoir-email","status":"configured"}`
   - HTTP 503: `{"ok":false,"service":"parkmemoir-email","status":"missing_config"}`
   - The health check verifies **presence of bindings/configuration only** — not API permissions, D1 schema correctness, Turnstile success, or real inbox delivery.
   - The Worker intentionally returns 404 on `*.workers.dev` and unknown hosts; do not interpret that as a code failure.

## Real inbox QA — separate explicit approval

- One-time requested plan email must receive Turnstile action `email_plan`, originating at `https://parkmemoir.com` or `https://www.parkmemoir.com`; a browser cannot simply GET the POST endpoint.
- Test a controlled inbox, verify Resend delivery status and actual receipt; do not infer delivery merely from the API's HTTP 200.
- This Worker emails the plan and a **print-to-PDF link**, NOT a PDF attachment.
- One-time email must **not** create a marketing contact. Separate seasonal consent action `seasonal_signup` must first send a 48-hour confirmation email. A GET does not subscribe; the user must POST by clicking the confirmation button.
- Once confirmed: Resend Contact topic `PARKMEMOIR Seasonal Updates` is `opt_in`, Segment membership exists, and D1 consent status is `confirmed`.
- Confirm negative paths: expired/duplicate token, wrong origin, failed Turnstile, Resend failure, rate limit, globally unsubscribed contact. Validate consent/privacy/unsubscribe policy before any marketing Broadcast.
- After live backend QA, create a separate PARKMEMOIR website PR with email feature flags OFF by default; its own CI/merge/production workflow/live QA remains required.

**Release statuses:** `SOURCE_CI_PASS` is not `WORKER_DEPLOYED`; `/health` 200 is not `EMAIL_DELIVERED`; `WORKER_LIVE_QA_PASS` is not `PARKMEMOIR_SITE_PRODUCTION_PASS`.

## Alternate CLI method (developer only)

If using Wrangler instead of dashboard, copy `wrangler.toml.example` to ignored `wrangler.toml`, fill in **existing** D1 UUID, Segment ID and Topic ID. `wrangler deploy` changes the live Worker; Cloudflare may overwrite dashboard-defined plain-text vars unless `--keep-vars` or equivalent configuration is applied. Never paste private key values in TOML; four secrets are already configured in dashboard. Do not run deployment without explicit authorization.

Official Cloudflare references:
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/workers/wrangler/commands/workers/
- https://developers.cloudflare.com/workers/versions-and-deployments/
