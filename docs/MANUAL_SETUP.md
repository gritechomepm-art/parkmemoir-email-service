# PARKMEMOIR — Isolated Email Worker Setup

**Current state (2026-11-09): source candidate only; sender verified; Worker not deployed.** Do not merge or publish on CI alone.

## Already completed in Resend

- Sending domain `mail.parkmemoir.com`: **Verified** (DKIM TXT, SPF MX, SPF TXT and CNAME; sending on, receiving off).
- Verified sender format for this service: `PARKMEMOIR <plans@mail.parkmemoir.com>`.
- Marketing Segment `PARKMEMOIR — Confirmed Seasonal Updates` exists.
- Marketing Topic `PARKMEMOIR Seasonal Updates` exists with default subscription `opt_out`.
- Existing `Onboarding` API key is not used by this Worker.
- No real email delivery tests, Cloudflare Worker route or D1 resource deployed.

**Important:** The sending domain `mail.parkmemoir.com` is different from the proposed API host `email.parkmemoir.com`. There is no reason to change the verified sending-domain DNS again.

## Step 1 — Two credentials in Resend (owner; do not paste them anywhere public)

At https://resend.com/api-keys create:

1. `parkmemoir-email-send`: **Sending access**, restricted to `mail.parkmemoir.com`; store in the Worker secret `RESEND_API_KEY`.
2. `parkmemoir-consent-contacts`: **Full access**, needed only for GET/POST Contacts, PATCH Topics, POST Segment membership; store in Worker secret `RESEND_CONTACTS_API_KEY`.

The full-access key has broader platform permissions. The Worker never serves it to the browser. Do not place either value in code, GitHub files, logs or chat. Marketing signup/confirmation fails closed until the second key is installed.

## Step 2 — Isolated Cloudflare resources

In Cloudflare Workers & Pages, set up a new Worker named `parkmemoir-email` (NOT `parkmemoir-public-p0`). Do not attach the current production website's database, API, Digital Companion or static-worker bindings.

Create D1 database `parkmemoir-email-consent`; apply `migrations/0001.sql` to this D1 only:

```bash
npx wrangler d1 create parkmemoir-email-consent
npx wrangler d1 execute parkmemoir-email-consent --remote --file=migrations/0001.sql
```

Create a Cloudflare Turnstile widget for `parkmemoir.com` (also `www.parkmemoir.com` if needed). The frontend action names are `email_plan` and `seasonal_signup`. Public site key belongs only in the browser; secret key only in the Worker.

## Step 3 — Worker config (not a live deploy)

Copy `wrangler.toml.example` to **untracked** local `wrangler.toml`. Replace `SET_REAL_D1_DATABASE_ID_AFTER_MIGRATION`, `SET_REAL_RESEND_SEGMENT_ID` and `SET_REAL_RESEND_TOPIC_ID` with actual account values. Keep:

- `EMAIL_FROM = "PARKMEMOIR <plans@mail.parkmemoir.com>"`.
- `SUBSCRIBERS` D1 binding tied to the dedicated database.
- `workers_dev = false`, `preview_urls = false`, and the Custom Domain route commented out until owner approves deploying the email Worker.
- Cron enabled for pending-confirmation/rate-limit cleanup.

Store four **Secrets** on `parkmemoir-email`: `RESEND_API_KEY`, `RESEND_CONTACTS_API_KEY`, `TURNSTILE_SECRET_KEY`, and random `RATE_HASH_SECRET` (at least 32 cryptographically random bytes, represented as hex).

**Caution:** Modern `npx wrangler secret put NAME` immediately deploys a new Worker version. For predeployment setup, use Cloudflare Dashboard > Worker > Settings > Variables and Secrets (type **Secret**), or `npx wrangler versions secret put NAME` on a staged version, and inspect any deploy UI prompts before confirming. The existing public marketing Worker must remain untouched. Check current Cloudflare documentation: https://developers.cloudflare.com/workers/configuration/secrets/.

## Step 4 — Source verification before production

```bash
node --check worker.mjs
node --check worker.test.mjs
node --test worker.test.mjs
```

CI runs mocked tests; this does **not** prove Resend sending, Cloudflare DNS binding, D1 schema or inbox arrival.

## Step 5 — Explicit production approval and live QA

After source CI passes, owner reviews PR and authorizes its merge. **Separately** authorize uploading/deploying this new Worker; only then enable Custom Domain `email.parkmemoir.com`, verify DNS/TLS and release. Never route `parkmemoir.com/*` to the service Worker.

- Send one requested plan to a controlled test inbox. Expect HTTP 200 `{"ok":true,"status":"accepted"}`; verify inbox and saved-plan/print-PDF URL. The Worker **does not attach a PDF binary** (as agreed in Winter Planner V5.7); it sends a private email with an instruction to reopen and print the existing planner.
- Verify **no marketing Contact** appears after transactional sending.
- Click a separately unchecked-by-default seasonal checkbox and submit; test email confirmation link. GET confirmation page alone must not subscribe.
- Click Confirm POST; check D1 audit status, Resend Segment membership and explicit Topic `opt_in`. Test expired, duplicate, provider errors, and globally unsubscribed contacts.
- Marketing unsubscribe, privacy disclosures, reconciling D1 and Resend after errors, and any bulk-send setup require separate approval before sending broadcasts.
- Confirm no secrets or recipient email addresses in GitHub, analytics, or Worker logs.

Only after live tests pass may the separately reviewed PARKMEMOIR website PR enable the planner frontend config. Keep `PARKMEMOIR_PLAN_EMAIL_CONFIG.enabled = false` and `PARKMEMOIR_SEASONAL_CONFIG.enabled = false` until then.

## API contract for Winter Planner V5.7

`POST https://email.parkmemoir.com/api/send-plan` with JSON:

```json
{
  "requestedOnly": true,
  "email": "visitor@example.com",
  "plan": {"v":1,"park":"zion","month":"nov","days":2,"stay":"camping","load":["fridge","phones"],"recharge":"none","method":"none","vehicleConfirmed":false,"portableAway":false,"fridgeW":18,"fridgeModel":"other","fridgePlug":"unknown","fridgePeak":"","fridgeOwned":"no","unchecked":[],"sample":false},
  "turnstileToken": "TOKEN_FROM_CLOUDFLARE_BROWSER_WIDGET",
  "pageUrl": "https://parkmemoir.com/which-national-parks-are-open-in-winter/",
  "npsUrl": "https://www.nps.gov/zion/planyourvisit/conditions.htm"
}
```

`/api/seasonal-subscribe` takes `{email,consent:true,consentVersion:"pm-seasonal-updates-v1-2026-11-08",sourcePage,turnstileToken}`. Only explicit POST of the email's confirmation token activates consent.

**Release status:** `DOMAIN_VERIFIED / WORKER_SOURCE_REVIEW / PRODUCTION_NOT_DEPLOYED`.
