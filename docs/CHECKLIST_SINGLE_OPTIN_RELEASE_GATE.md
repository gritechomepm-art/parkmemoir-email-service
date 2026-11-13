# Packing List one-time email and single opt-in — REVIEW ONLY

This PR is a candidate, not production-ready. **Do not merge** without owner review, D1 migration and live security/provider QA. A merge into main can trigger the independent Worker production deploy workflow.

## API

POST \`https://email.parkmemoir.com/api/send-checklist\` accepts:
- \`email\`: one adult address
- \`seasonalUpdates\`: boolean (defaults to false in the UI)
- \`consent\`: exactly the same boolean, provided only after the user's explicit unchecked-by-default checkbox action
- \`consentVersion\`: \`pm-seasonal-updates-v2-direct-2026-11-13\` when checked; otherwise null
- \`sourcePage\`: exactly \`https://parkmemoir.com/national-park-packing-list/\` or www equivalent
- \`trip\`: exact \`family\`, \`season\`, \`stay\` values
- \`checkedItems\`: IDs of checked **visible** items only
- \`turnstileToken\`: server-validated action \`checklist_send\` at parkmemoir.com

### Success response

HTTP 200 \`{ "ok":true, "checklist":"accepted", "seasonal":"not_requested|subscribed|blocked|unavailable|failed" }\`.

The \`checklist=accepted\` status means Resend accepted the email with the generated PDF attachment, not that it reached the inbox. The \`seasonal\` result is independent: \`blocked\`, \`unavailable\`, \`failed\` **must not** be shown as "subscribed".

The server validates filter values and item IDs against a fixed catalog and generates a PDF from **trusted server-side content**. The browser must never send HTML to the server. Browser Run is required, with network requests denied. Resend is invoked with a deduplication key and per-IP daily rate limit. The request is rejected if Turnstile is missing, wrong action or wrong origin. The standalone HTML preview never makes live email requests.

## Single opt-in scope

- Applies only to the packing-list form, when the optional unchecked checkbox is intentionally checked.
- No new confirmation email is sent; D1 records consent version, canonical source path and timestamps in the separate \`pm_checklist_direct_consent\` table.
- Existing global Resend unsubscribers and prior D1 unsubscribed users are not reactivated by this form.
- Resend Topic must remain default \`opt_out\`; the new form explicitly opts in after validation.
- Existing \`/api/seasonal-subscribe\` Double Opt-in and \`/api/send-plan\` Winter Planner routes remain unchanged.
- Broadcasts must have correct audience/topic, a working one-click unsubscribe or provider unsubscribe and a valid sender physical postal address; confirm privacy policy/retention changes before marketing.
- Single opt-in is not a general legal determination for every jurisdiction. If a visitor's applicable rules require additional consent proof, do not enable it there without legal review.

## Release gates

1. Run \`node --check checklist.mjs\` and \`node --test checklist.test.mjs\`, plus existing complete CI. **Draft PR only.**
2. Apply \`migrations/0002_checklist_direct_consent.sql\` to the isolated email-consent D1 only *before deploying code*; do not alter the existing Winter Planner database or records.
3. Configure a separate Turnstile front-end action \`checklist_send\` for parkmemoir.com; server secret stays in Worker; do not put secrets in public source. Validate host and action using real Turnstile.
4. Update the approved Packing List HTML/Next.js page only in a separate website PR, with one email field and one optional unchecked marketing consent checkbox. Change the front-end consentVersion to \`pm-seasonal-updates-v2-direct-2026-11-13\`, use visible checkmarks and include the Turnstile token.
5. Test controlled inbox one-time PDF, no-contact on unchecked, explicit opt-in on checked, blocked opt-out, failed provider, throttling, failed PDF, mobile and printable content. Validate subscription in Resend Topic/Segment and D1, then test unsubscribe suppression.
6. Obtain separate permission to merge and deploy. Production worker workflow is auto-triggered on main: **merging is not an innocuous staging action**.

## Future integrations

- The public Packing List page must not show an active email-send CTA unless this endpoint has actually been deployed and tested.
- Preserve the V4.1 user-facing single-email form and no-confirmation preference; do not reintroduce a second email input or confirmation step.
