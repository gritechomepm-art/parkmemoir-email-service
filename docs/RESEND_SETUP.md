# Resend setup — PARKMEMOIR email service

Status: **ACCOUNT SETUP PENDING**. This repository is not currently deployed. Do not claim emails are live merely because GitHub CI passes.

## Goal and boundaries

- Transactional: email a visitor's requested winter-trip plan one time, without adding that email to a contact list.
- Marketing: a **separate**, unchecked-by-default "Send me seasonal updates" control, followed by double opt-in. Never infer marketing consent from requesting the plan.
- Use Resend's free tier initially; no requirement to upgrade Cloudflare.
- Keep this email Worker independent of the existing PARKMEMOIR production site. Changes to the site require their own PR, Source CI, production workflow, and live QA.

## 1. Connect Resend (human authorization required)

1. Sign in to https://resend.com or create a free account.
2. If you want an assistant to access your account, open https://chatgpt.com/plugins/resend, install the official Resend plugin and authorize via Resend OAuth. Installation/authorization is always a user action.
3. Official alternative remote MCP URL (for compatible clients): https://mcp.resend.com/mcp.
4. Do **not** paste an API key into ChatGPT, GitHub code or public issues.

Official reference: https://resend.com/docs/mcp-server

## 2. Verify a sending subdomain

Suggested sending domain: `mail.parkmemoir.com` (keeps existing mail routing for `parkmemoir.com` untouched).

1. Resend Dashboard > Domains > Add Domain > enter `mail.parkmemoir.com`; enable **Sending**.
2. Resend will display domain-specific DNS records. In Cloudflare DNS for `parkmemoir.com`, add **exactly** those DKIM, SPF / return-path and any additional records shown by Resend. **Do not copy example DNS values from blog posts**. Preserve existing apex MX, SPF, DKIM and DMARC records for any current mailbox.
3. Return to Resend and verify until its **Sending** capability displays Verified. Receiving-email verification is not required for this sender-only Worker.
4. Use `PARKMEMOIR <plans@mail.parkmemoir.com>` for one-time plans. An address under a verified subdomain is different from an address at the apex domain.
5. Consider DMARC alignment and a working reply-to mailbox, when available; do not invent a mailbox without verifying it.

Official reference: https://resend.com/docs/dashboard/domains/introduction

## 3. Create a least-privilege API key

1. Resend Dashboard > API Keys > Create API Key.
2. Name: `parkmemoir-email-service-production`.
3. Permission: **Sending access** (not Full access); restrict the key to `mail.parkmemoir.com` where available.
4. Store as Cloudflare Worker **secret** `RESEND_API_KEY`, not as a plain `[vars]`, repository file, GitHub issue, build output or a browser variable.
5. Define the non-secret sender value `PLAN_FROM_EMAIL=PARKMEMOIR <plans@mail.parkmemoir.com>` in Worker configuration at implementation time.
6. Never output the key in logs. Rotate it immediately if exposed.

Official reference: https://resend.com/changelog/new-api-key-permissions

## 4. Separate opt-in workflow (not part of initial email-send key setup)

- The requested PDF email is **transactional**; do not create a marketing contact from it.
- "Send me seasonal updates" is a separate and initially **unchecked** action.
- Send one consent confirmation email after that action; only confirmed addresses can enter the subscriber list.
- Store consent timestamp, confirmation status and unsubscribe state. Provide unsubscribe on any future marketing campaign.
- If using Resend Contacts / Broadcasts APIs, account-management permissions are separate from a Sending-only key. Do not silently grant Full access or reuse an unrestricted key in the public Worker.
- The list, verification token handling, suppression behavior, consent copy and bounce handling all require implementation and test before marketing sending is enabled.

Official references: https://resend.com/features/audiences ; https://resend.com/legal/acceptable-use

## 5. Production acceptance checklist

- [ ] Domain sending status is Verified in Resend
- [ ] Sending-only restricted API key stored as Cloudflare Worker secret
- [ ] Worker source, rate limits, validation and idempotency reviewed
- [ ] Worker staging endpoint deployed and tested without storing transactional recipients
- [ ] One-time PDF received by user-authorized test mailbox (with PDF opening correctly)
- [ ] Error handling, resend failure and retries tested
- [ ] Separate unchecked marketing consent verified
- [ ] Double opt-in confirmed, duplicate confirmation and unsubscribe tested
- [ ] No email or API key in public logs, GitHub or analytics
- [ ] Production deployment explicitly approved and verified; capture Deployment/Version ID

**Do not mark production READY until every applicable check is evidenced.**
