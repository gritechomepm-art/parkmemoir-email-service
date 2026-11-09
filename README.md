# PARKMEMOIR Email Service

**Status: candidate code only — sending domain verified 2026-11-09; no Cloudflare Worker deployment, real inbox test or production launch.**

This repository is the **isolated** service for PARKMEMOIR's optional email features. Migrated from [PARKMEMOIR PR #38](https://github.com/gritechomepm-art/parkmemoir/pull/38) after its public-site static-only release gate rejected unrelated backend files. Never weaken or remove protections from the main PARKMEMOIR repository.

## Scope and data boundaries

- \`POST /api/send-plan\`: user-requested **one-time transactional** trip-plan email. It does **not** create a Resend Contact, segment member, subscription or marketing list.
- \`POST /api/seasonal-subscribe\`: **separate affirmative consent**, Turnstile, D1 pending proof, 48-hour confirmation email; no Resend marketing Contact yet.
- \`GET /api/seasonal-confirm?token=...\`: view only, never subscribes.
- \`POST /api/seasonal-confirm\`: explicit confirmation; check global unsubscribe suppression, add Resend Contact to the configured Segment, record D1 confirmation.
- IP-hash daily throttling, restricted site origins, exact host routing, idempotent plan sends, dedicated consent D1 and scheduled cleanup.
- Sending and Contacts API keys are separated; opt-in Topic remains default-off until an explicit confirmation POST.
- `GET /health`: non-sending binding-presence check, which does not validate actual delivery or D1 contents.
- Absolutely no Digital Companion storage, existing marketing Worker bindings or changes to PARKMEMOIR's production UI.

**Service host:** \`email.parkmemoir.com\`. Only \`https://parkmemoir.com\` and \`https://www.parkmemoir.com\` may call the public CORS endpoints.

## Code layout

\`\`\`
worker.mjs                  independent Cloudflare email Worker
worker.test.mjs             mocked Resend, Turnstile and D1 semantics
migrations/0001.sql         isolated consent and rate-limit tables
wrangler.toml.example       intentionally non-deployable sample
.github/workflows/ci.yml   source-only tests; NEVER deploys
docs/MANUAL_SETUP.md        owner setup and release gates
docs/DASHBOARD_DEPLOY_CHECKLIST.md  dashboard-only source-to-deploy procedure
\`\`\`

## Local and GitHub CI

Node.js 24 required for built-in \`node:sqlite\` test harness. No npm dependencies are needed for tests.

\`\`\`sh
node --check worker.mjs
node --check worker.test.mjs
node --test worker.test.mjs
\`\`\`

The GitHub Actions workflow repeats these checks on pull requests and pushes. It does not log in to Cloudflare or Resend; a successful CI is not a live delivery test.

## Release rule

1. Owner reviews and approves code PR after CI.
2. Owner independently completes and verifies Resend / Cloudflare configuration in \`docs/MANUAL_SETUP.md\`.
3. Owner explicitly authorizes **separate Worker deployment** and real inbox tests. Never deploy merely because CI passed.
4. After live email and Double Opt-in tests, create a **separate** website PR connecting owner-approved Winter Planner V5.8. Keep both feature flags disabled until validated.
5. The separate PARKMEMOIR website release still requires Source CI PASS → merge → approved production workflow → live QA → PRODUCTION_PASS evidence.

**Never put API keys, customer emails, D1 UUIDs from private accounts or test tokens into GitHub, issue comments or chats.**
