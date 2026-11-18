# Transactional communications

Decision recorded 17 November 2026: include transactional communications only. Marketing campaigns and newsletters are excluded. Email and existing in-app notices are the initial channels; SMS, WhatsApp, mobile push and a separate support-ticket product are not included. Q55 selects Postmark for application transactional mail and Supabase Auth custom SMTP; Stripe retains supported billing notices under the existing per-event ownership policy. Sending settings remain to verify; no services are configured.

## Messages and ownership

| Message | Recipient and channel | Owner |
|---|---|---|
| Account verification, recovery and selected authentication emails | Account holder; email appropriate to the accepted auth flow | Supabase Auth owns token generation/validation; custom SMTP via selected Postmark; P2-01 integrates the chosen flow |
| Workspace/facilitator or workshop invitation | Explicit invited recipient; email with scoped, expiring link | Debrio; invitation permissions in P2-01, delivery in P4-06 |
| Workshop reminder, reschedule or cancellation | Current authorized invitees; email and relevant in-app status | Debrio; P4-06; reminder schedule/timezone and cancellation rules accepted before implementation |
| Resource release, help response and facilitator announcement | Only the authorized individual/group/session audience; existing in-app channels | Existing P3-01/P3-03 flows; no automatic email copy of private workshop content |
| Payment action, failed payment, renewal/trial reminder, receipt/invoice | Authorized workspace billing contact; email | P6-03 defines a per-event owner, using Stripe-native notices where supported and configured; Debrio sends only required gaps |
| Subscription/access change | Workspace billing administrator; in-app billing status and agreed email confirmation | Debrio P6-03, reconciled to Stripe; avoid repeating a Stripe-owned notice |

Participants join free and do not receive their host's invoices or payment-failure messages. Billing authority does not grant access to private workshop content. A participant may join using the existing guest-link path without supplying an email address; email delivery requires an explicitly supplied recipient address and is not an additional admission requirement.

Privileged-account authentication includes second-factor enrollment and secure recovery; account-security notices stay scoped to the affected account. Account recovery must not be confused with facilitator-verified guest recovery. Publish support hours/timezone, incident information and a contact route for the initial paid service; named live pilot incident coverage and the actual notification destination must be confirmed before the pilot. No 24/7 response guarantee is implied.

The host/billing contact may be an individual trainer or consultant using a personal email address. Templates must work with a person's name and workspace label, without requiring a company name, corporate domain or team invitation. Existing audience and authorization rules still apply.

Client-summary invitations go to the invited address. Require verification for its contact/session grant and show the 30-day expiry; no public share link or expiry reset on repeat verification. Tester notices show the exact 30-day-from-redemption end, no-card requirement, read-only expiry and explicit paid opt-in; no automatic paid renewal. Client invitations expire after seven days if unredeemed; a replacement cannot silently extend an existing 30-day grant. Add deletion warnings during the 90-day reusable-content recovery period after entitlement ends. Owner-transfer notices must distinguish invitation from recipient acceptance. Show cancellation effective date and retained access through the paid period. Failed-renewal notices must show the seven-day grace deadline and resulting new-hosting restriction, only to that workspace's authorized billing contacts. Other notice timing remains open.

## Accepted managed setup

The supplied product domain is debrio.app. Domain control, DNS, sending subdomain and reply-to mailbox remain unverified; naming the domain does not authorize DNS changes or email sending.

Use Postmark for Debrio transactional email and Supabase Auth custom SMTP. Supabase Auth remains responsible for authentication flows and tokens. Use a transactional Message Stream and verified sender/domain; require encrypted SMTP for authentication mail and keep credentials server-side. Verify sender/reply-to, monitored support mailbox, provider retention and actual allowance/cost before sending; selection does not authorize additional spending. Postmark documents this integration directly. [Postmark with Supabase](https://postmarkapp.com/support/article/integrating-postmark-with-supabase-via-smtp), [Postmark SMTP](https://postmarkapp.com/developer/user-guide/send-email-with-smtp), [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Use Stripe's supported billing emails where appropriate, with their settings explicitly verified. Do not assume all desired notices are enabled by default or available for every billing configuration. Assign each email event to Stripe or Debrio, then test the actual configuration. In-app billing state remains Debrio's responsibility. [Stripe customer emails](https://docs.stripe.com/billing/revenue-recovery/customer-emails).

Persist application delivery intents with the relevant committed event and process them using a bounded, retryable job in the accepted managed runtime. P0-02 selects the scheduler/dispatcher and verifies its limits; no separate always-on server is implied. Do not use in-memory timers or depend on work continuing after a Vercel response. In-app workshop notices continue through the existing persisted state/private-channel design.

## Delivery contract

- Maintain a small event/template registry: trigger, audience, channel, sender owner, preference category, deduplication key, schedule/expiry and allowed template fields. Recheck recipients, authorization, session version and preferences at dispatch; cancel stale reminders after a reschedule, cancellation, invitation revocation or recipient removal.
- Apply timezone-aware scheduling and accept reminder timing before implementation. Bound retries, rate-limit invitation/resend actions, expose failed or ambiguous delivery, and provide a controlled retry path. A retry must not intentionally duplicate an already accepted send; document provider idempotency limits and reconcile ambiguous outcomes.
- Authenticate Postmark webhooks using its documented supported protection (HTTPS with configured authentication), validate payloads and workspace/message mappings, deduplicate events, and handle reordering. Do not invent a Postmark signature scheme; Stripe signature verification remains separate. Verify the selected protection against [Postmark webhook documentation](https://postmarkapp.com/developer/webhooks/webhooks-overview). Distinguish queued, provider-accepted, delivered, bounced, complained and failed where evidenced. Delivery never means a human read the message; disable open/click tracking unless separately justified and accepted.
- Respect optional reminder preferences and provider bounce/complaint suppression. Define essential account/service categories explicitly; do not import another project's blanket opt-out bypass. Marketing preferences are unnecessary while marketing is excluded.
- Escape untrusted template values. Never put private briefs, answers, feedback, captions, payment details or recipient lists in email. Send recipients individually and link back to an authorized page. Ordinary content links must recheck current permissions; authentication/invitation links retain the explicit scoped-token policy. Redact tokens and addresses from routine logs and demo evidence.
- Store minimal delivery metadata with an accepted retention policy. Prevent another workspace from reading delivery records or using the sender as an arbitrary email relay. Test and rehearsal environments use a mail sink or explicit test-recipient allowlist; synthetic demo execution must not contact real participants.

## Completion and ownership

P0-02 records accepted Postmark and verifies domain ownership, sender/reply-to, templates, timing, preference categories, runtime and retention policy. P2-01 owns auth/invitation semantics and the functional Postmark SMTP authentication-delivery path; P4-06 completes broader application email and delivery operations. P4-06 implements and proves non-billing delivery before P5-01/pilot readiness. P6-03 integrates billing communication ownership and configuration before tester readiness, including agreed discount confirmation/end notices. Existing live chat/announcement/resource requirements keep their current owners.

Prove permitted and cross-workspace recipients, expired/revoked invites, duplicate/concurrent dispatch, provider outage/timeout, retry recovery, bounced/complained addresses, webhook replay/reordering, reschedule/cancellation races, timezone/daylight-saving boundaries, preference changes and accessible templates. Capture synthetic email previews and in-app flows with a written test/commit record. Provider receipt tests use only explicitly authorized test addresses; mocks cannot prove inbox delivery.

This planning update sends no messages and does not configure domains, providers or account settings.
