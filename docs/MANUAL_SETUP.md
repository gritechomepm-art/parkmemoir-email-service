# Manual account-owner setup: Cloudflare + Resend

**Do not do these steps until the isolated email-service PR passes CI and you approve deployment.** The repository CI does not deploy anything. No API key should be copied into ChatGPT or GitHub.

## A. Resend account — owner action

1. Open [Resend Domains](https://resend.com/domains). Add a subdomain for sending such as \`mail.parkmemoir.com\` (or another verified domain you control). Publish the exact SPF/DKIM records shown by Resend in Cloudflare DNS. Review DMARC and verify status. Sender email must belong to the verified domain; if sending as \`plans@parkmemoir.com\`, verify \`parkmemoir.com\` itself instead.
2. Create a dedicated sending-capable API key in [Resend API Keys](https://resend.com/api-keys); do not expose it. A restricted key may be insufficient if it cannot query/create Contacts or edit Segments, so verify required scopes.
3. Under [Resend Segments](https://resend.com/segments), create \`PARKMEMOIR Seasonal Updates\`; record the Segment ID privately. Check free-tier caps in your account.
4. Verify Resend's present-day Contacts and Segments API, global unsubscribe behavior and Broadcast unsubscribe settings before any broadcast. Existing globally unsubscribed users must **not** be reactivated by confirmation.

## B. Cloudflare account — owner action

1. Confirm \`parkmemoir.com\` is in your Cloudflare zone. Create a **separate** Worker \`parkmemoir-email\`; do not modify or bind anything to the static-only \`parkmemoir-public-p0\` Worker.
2. Create D1 \`parkmemoir-email-consent\` and obtain its private UUID. Apply \`migrations/0001.sql\` to this database **only**. Use Cloudflare dashboard or the CLI after a safe review:

   \`\`\`sh
   npx wrangler d1 create parkmemoir-email-consent
   npx wrangler d1 execute parkmemoir-email-consent --remote --file=migrations/0001.sql
   \`\`\`

3. Register a Turnstile widget for \`parkmemoir.com\` (include \`www.parkmemoir.com\` if applicable). In the site code, action names must be \`email_plan\` and \`seasonal_signup\`; keep site key public and secret server-side.
4. Make a local copy of \`wrangler.toml.example\` named \`wrangler.toml\`. Change the D1 \`database_id\` to the actual UUID; set \`EMAIL_FROM\` to the verified sender; set \`SEASONAL_SEGMENT_ID\` to the real Segment ID. Only after approval uncomment the separate Custom Domain mapping \`email.parkmemoir.com\`. Do not route \`parkmemoir.com/*\` through this Worker.
5. Configure Worker Secrets on \`parkmemoir-email\` only (not in a committed file):

   \`\`\`sh
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put TURNSTILE_SECRET_KEY
   npx wrangler secret put RATE_HASH_SECRET
   \`\`\`

   Use a cryptographically random RATE_HASH_SECRET. Verify the Worker has \`SUBSCRIBERS\` D1 binding. Check existing free-tier CPU/request/D1 limits.

6. With explicit approval and a reviewed config, deploy the **new Worker only**; validate Custom Domain DNS and TLS. Its routes reject unexpected hosts and origins.

## C. Acceptance tests — before website hookup

- One-time \`Send Plan\` delivers to a real test inbox and creates **no** marketing Contact/Segment membership.
- Separate Seasonal Updates checkbox is **not checked by default**; requesting consent sends confirmation but creates **no** marketing contact.
- Opening the GET confirmation link is inert; pressing the form confirmation POST creates one Contact and membership in exactly the intended Segment.
- Repeat clicks, expired links, failed Turnstile, improper origins, provider rejection and throttle fail safely. Existing global unsubscribes remain suppressed.
- Check delivery status and actual inbox, not just Resend HTTP 200. Test from mobile, check link privacy and no secret exposure.
- Complete privacy notice, postal address/identity if applicable, retention and deletion process, D1/Resend unsubscribe reconciliation, and approved marketing copy before ever sending Broadcasts.

## D. Only then: website integration

Update owner-approved Winter Planner frontend through a new website PR. Before the main planner script, insert public config **only** after live backend acceptance:

\`\`\`js
window.PARKMEMOIR_PLAN_EMAIL_CONFIG = {
  enabled: true,
  endpoint: "https://email.parkmemoir.com/api/send-plan",
  siteKey: "YOUR_PUBLIC_TURNSTILE_SITE_KEY"
};
window.PARKMEMOIR_SEASONAL_CONFIG = {
  enabled: true,
  endpoint: "https://email.parkmemoir.com/api/seasonal-subscribe",
  siteKey: "YOUR_PUBLIC_TURNSTILE_SITE_KEY"
};
\`\`\`

Until then, keep both enabled flags \`false\`. Existing Save Plan, Share Link and PDF features stay functional. Do not change website Logo, existing disclosures, GA4, SEO or frozen public release gates.

**Account actions still requiring the owner:** Resend sender verification and Segment, Cloudflare D1/Turnstile/Worker secrets/custom domain, live inbox testing and explicit production-deploy authorization.
