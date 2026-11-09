# Full Winter Planner PDF — one print source, two delivery paths

**State: source implementation only; not deployed.** Do not merge PR #3 or change the existing `parkmemoir-email` Worker until owner approves the new Browser Run binding and real QA.

## Canonical content

The saved **PARKMEMOIR Winter Parks Planner Preview V12.5** already generates the full printable report in `#print-plan` via `preparePrint()` when `beforeprint` fires. This includes:

1. Selected park/month/days/group/stay and road-access/hotel-or-camping rules
2. Climate, NPS conditions, winter safety caveats and off-grid battery sizing
3. Selected packing checklist
4. Matching partner product and/or Stay22 offers as applicable, with clickable links
5. One Affiliate Disclosure at the offers section (no duplicate affiliate text on each product link)

There is **no downloadable PDF file on the public site's main branch yet**. The approved planner remains a standalone HTML preview and browser-print workflow. The separate email service must **not** fabricate a reduced version from the JSON plan.

## Implementation in this branch

- Browser adapter `client/full-print-snapshot.mjs` dispatches `beforeprint` and captures the **same** existing `#print-plan.outerHTML` and inline CSS used by the Save/Print action. An EXAMPLE plan cannot be emailed until the visitor customizes it.
- The request includes `printSnapshot = {version:"winter-full-print-v12.5",markup,css}`, alongside the existing validated plan + Turnstile token.
- Isolated Worker validates section markers and blocks scripts, inline event handlers, network-backed image resources, and dangerous HTML before invoking **Cloudflare Browser Run Quick Action `pdf`** from the `BROWSER` binding.
- Headless Chrome renders the provided **full print snapshot**, using A4 / CSS page size and backgrounds, then the exact bytes returned from Browser Run are attached with Resend as `PARKMEMOIR_Full_Winter_Trip_Plan.pdf`.
- No independent summary renderer or old print/share URL remains in the email. Resend transactional mail does not create a marketing contact. The DOI flow stays separate and retains the earlier Origin/diagnostic fix.
- The Worker requires the new `BROWSER` binding before `/health` reports `configured`. **No new API key or secret** is required for the binding; Cloudflare Browser Run is available on Workers Free subject to its limits.

## Local PDF regression comparison (real Chromium PDF, not mock)

A controlled local browser rendered the actual saved V12.5 preview, called `beforeprint`, and generated two files from the exact same trip selection: (a) original page's full print view and (b) the serialized print DOM + CSS used as the email renderer's input.

| Scenario | Web print | Print snapshot renderer | Result |
| --- | --- | --- | --- |
| Zion / January / 4 people / dispersed / fridge | 2 pages / 8 links | 2 pages / 8 links | Full text identical; pixel diff 0 at 120 DPI |
| Joshua Tree / hotel / lodging offer | 1 page / 6 links | 1 page / 6 links | Full text identical; pixel diff 0 at 120 DPI; **same Stay22 affiliate URL** |
| Zion / dispersed / Anker power recommendation | 2 pages / 9 links | 2 pages / 9 links | Pixel diff 0; **same Anker PartnerBoost UID and clickable URL** |
| Affiliate disclosure | present | present | PASS |
| Actual Resend PDF attachment | not tested | not tested | PENDING |
| Actual Cloudflare Browser Run | local Chrome proxy only | not tested in Cloudflare | PENDING |

The two PDF files differ slightly in metadata and file length. **Text, links and visual page rendering were identical** in local QA; byte-identical output is not required because Chrome metadata is runtime-dependent.

## Cloudflare account-owner changes required before deploying this branch

1. In **Workers & Pages → parkmemoir-email → Bindings**, add a **Browser Run** binding named `BROWSER`. Its proposed Wrangler config is `[browser]\nbinding = "BROWSER"`. Do **not** add it to `parkmemoir-public-p0`.
2. Existing `SUBSCRIBERS` D1, four Secrets, three Text variables, and the `email.parkmemoir.com` custom domain remain unchanged.
3. Cloudflare Workers Free Browser Run currently permits a total of **10 browser-minutes per day**, with a Quick Actions rate limit of one request per 10 seconds. Rate-limit and quota tests must precede production traffic. See https://developers.cloudflare.com/browser-run/limits/.
4. New site integration must be implemented in the main PARKMEMOIR repository as a **separate owner-approved PR**. Reuse `client/full-print-snapshot.mjs` with Turnstile action `email_plan`. Do not turn email UI on before backend QA. Do not immediately enable email features on the current static Winter Parks page (which still lacks full V12.5).
5. Preserve old Cloudflare Worker Version ID for rollback. After approval, redeploy only the independent Worker and confirm `/health` HTTP 200.
6. Real test: send a customized plan using live full planner UI, open actual PDF attachment, compare pages, packing list, recommendations, disclosure and partner/NPS link annotations. Check Resend status and a controlled inbox. Test subscription confirmation separately.

**Release gates:** SOURCE_CI_PASS → OWNER REVIEW → MERGE → MANUAL INDEPENDENT WORKER DEPLOY → BACKEND LIVE QA → SEPARATE SITE PR → SITE LIVE QA. No shortcut from mocked CI to production.

## Primary technical references

- https://developers.cloudflare.com/browser-run/quick-actions/pdf-endpoint/
- https://developers.cloudflare.com/changelog/post/2026-05-28-use-browser-run-quick-actions-directly-from-workers/
- https://developers.cloudflare.com/browser-run/limits/
