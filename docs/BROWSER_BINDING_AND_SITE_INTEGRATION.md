# Owner playbook — add Browser Run and connect the COMPLETE V12.5 PDF

**Do not deploy or merge automatically.** This is a preparation guide for the already-existing independent email Worker and a later, separate public-site PR. Source CI is not proof of live PDF delivery.

## A. Browser Binding (owner only)

1. Cloudflare Dashboard → **Workers & Pages → parkmemoir-email → Settings → Bindings → Add binding**.
2. If a **Browser Run / Browser Rendering** option is available, create binding name **BROWSER**. Leave existing **SUBSCRIBERS** D1 binding and 4 Secrets unchanged.
3. If Browser Run is not available in the dropdown, stop: **do not substitute a Worker, Service, KV or Secret binding**. The documented supported method is Wrangler configuration:

   ```toml
   compatibility_date = "2026-11-09"
   [browser]
   binding = "BROWSER"
   ```

4. PR #3 already includes `[browser] binding = "BROWSER"` in `wrangler.toml.example`, plus the D1 and secret declarations. **Do not deploy this example unchanged**: D1 ID and Resend Segment/Topic IDs are placeholders, and it intentionally has no active Custom Domain route.
5. When authorized to stage the Worker through Wrangler, copy the example to ignored `wrangler.toml`, fill the existing D1 ID and existing Segment/Topic IDs, retain the exact Worker name `parkmemoir-email`, preserve the current `email.parkmemoir.com` Custom Domain, and use `npx wrangler deploy --dry-run` first.
6. Wrangler normally overrides dashboard-configured plaintext variables: retain all three in config and use `--keep-vars` (or `keep_vars = true`) when actually deploying. Cloudflare documents that existing Secrets are preserved across deploy. **Actual deploy is a separate owner-authorized release.**

Official docs: https://developers.cloudflare.com/browser-run/get-started/ and https://developers.cloudflare.com/workers/wrangler/commands/workers/.

**Limits:** Workers Free Browser Run: 10 browser-minutes/day; Quick Actions 1 request/10 seconds. Build rate/quotas into frontend QA. Running `/health` only verifies binding presence; it does not render a PDF.

## B. Frontend publication prerequisite

The production `gritechomepm-art/parkmemoir` `main` still serves the original winter parks page and lacks the *complete* V12.5 interactive printable planner. The complete source is saved in the user's library as `PARKMEMOIR_Winter_Parks_Planner_Preview_V12_5.html`, not live on that main branch.

**Do not attach the email UI to the old public page.** Prepare a dedicated main-site PR that:
- Ports the **approved** V12.5 interactive planner markup and scripts to the site, without overwriting approved Logo/navigation/SEO/GA4/security gates.
- Preserves the **single** canonical `preparePrint() -> #print-plan` output and full print CSS used by the current "Save plan + offers (PDF)" button.
- Loads `client/full-print-snapshot.mjs` from this email service PR into the main site, ensuring site-side module import path exists. Do not use the external service repository as a runtime module URL.
- Adds separate **Email full PDF** and **Receive occasional seasonal updates** controls with **independent unchecked-by-default seasonal opt-in**.
- Uses the public Turnstile **Site Key**, with actions `email_plan` and `seasonal_signup` respectively; never put the private Turnstile Secret or Resend Key in the browser.
- Constructs one printable snapshot from the **same** existing DOM/CSS; sends `{requestedOnly:true,email,plan,turnstileToken,pageUrl,npsUrl,printSnapshot}` only after user clicks the email button, without automatically persisting email in marketing contacts.
- Keeps `PARKMEMOIR_PLAN_EMAIL_CONFIG.enabled=false` and `PARKMEMOIR_SEASONAL_CONFIG.enabled=false` until live backend acceptance. A preview environment can set these true with an explicitly controlled test inbox.
- Validates phone/mobile, hotel and dispersed camping, off-grid power + fridge, and no-device/no-offer scenarios; compare actual web print to email PDF text, pages, and *real* annotated affiliate URLs.
- Runs Source CI + Release Eligibility and merges only after owner approval, then separately deploys approved new main SHA and Cloudflare Version ID to production with Live QA.

## C. Blocking items before release

- Cloudflare owner has not confirmed the `BROWSER` binding is present.
- PR #3 is not merged and the new backend has not been deployed.
- Backend tests are mocked; actual Browser Run PDF rendering and actual Resend attachment not tested in live Cloudflare.
- The V12.5 complete planner is not yet installed on the public website.
- Earlier DOI confirmation failure remains to be retested with actual D1 state and Resend Contact/Topic/Segment changes.

**Status:** `BINDING_PENDING / PR3_OPEN / FRONTEND_INTEGRATION_PENDING / LIVE_QA_PENDING`.
