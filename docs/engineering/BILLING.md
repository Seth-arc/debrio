# Debrio subscriptions

Decision recorded 17 November 2026: Debrio uses a subscription model with Stripe as its billing provider. The workspace holds the subscription and can be owned by an individual trainer/consultant or an organisation; participants join workshops free. This records product direction, not implemented billing or an activated Stripe account.

Individuals can sign up, own a workspace, subscribe and facilitate without a registered company, corporate domain or team. Use one paid plan containing the complete core feature set for solo trainers and organisations, with explicit usage/capacity allowances. Maximum three live workshops per workspace initially, subject to independently verified global capacity/provider headroom; ordinary owner technical limits still apply. Privileged billing administrators must complete two-factor authentication and reauthenticate sensitive actions. Monthly billing only initially; annual billing deferred. Numeric price/currency and allowances remain open; no separate solo/team feature tiers. Collect applicable individual billing details without fictitious company fields.

## Proposed purchase experience

1. An authorized workspace billing administrator chooses a plan on Debrio's pricing page.
2. The server creates Stripe-hosted Checkout for that workspace and an allowed recurring Price.
3. Debrio confirms the applicable payment/subscription state with Stripe before granting paid access. The checkout return page shows pending confirmation when necessary.
4. The administrator opens a server-created Stripe customer portal session to manage payment details, invoices and the subscription, within the configured policy.

Stripe supplies recurring billing, hosted subscription checkout and a customer portal. Debrio supplies the pricing page, workspace identity, plan permissions and workshop experience. [Subscriptions](https://docs.stripe.com/billing/subscriptions/overview), [Checkout](https://docs.stripe.com/payments/checkout/build-subscriptions), [Customer portal](https://docs.stripe.com/customer-management).

## Decisions before implementation

Accepted initial offering: one complete paid plan plus invited tester coupons. Permanent public free workspaces/free preparation are deferred. Participants still join free. The platform owner has a separate permanent billing exemption described below; ordinary workspace owners do not inherit that exception.

## Permanent platform-owner access

The user, as Debrio's platform owner, can use the product indefinitely without a paid subscription or repeated tester coupons. Implement this as an explicit server-managed billing entitlement bound to a verified operator identity and the agreed workspace scope, not a client flag, a self-declared role, an email-domain match or a blanket bypass. Accepted scope: the designated owner workspace linked to the verified platform-owner account. Joining or administering customer workspaces does not exempt their subscriptions. Use the same technical capacity limits as other workspaces; changes require explicit configuration. The actual account/workspace identifiers are configuration inputs, not permission to widen this scope. Workspace ownership transfers must not transfer or mint this entitlement. It must not grant access to unrelated customers or weaken resource/publication permissions. Session-record retention remains independent of billing access; technical usage limits and the no-additional-infrastructure-spend constraint remain to be enforced according to the agreed owner policy.

P6-03 tests legitimate non-expiring operator access plus denial of forged claims, customer-owner self-upgrade, copied entitlements and transfer-induced privilege. Stripe remains authoritative for actual billing; an explicit operator exemption is not fabricated as a paid Stripe subscription. Do not apply this exception to tester accounts.

P0-02 settles billing architecture; prototype scaffolding does not require final prices. The user requires the complete product for coupon-based testers, so accept an initial price/currency, seats, capacity, allowances and remaining coupon policy after feasibility evidence and before pre-pilot P6-03 implementation. P6-03 keeps its ID but moves before P5-03 readiness. Buyer findings can refine the commercial offer later through explicit decisions, not silent changes to existing subscriptions. The 20-person pilot and later 40-person validation are engineering milestones, not automatically pricing tiers.

The constraint is no additional infrastructure spending, with a professional and complete setup. Existing accounts, included allowances and available credits are permitted only if they incur no additional spending. Invited tester coupons cover 100% of the subscription price for 30 days from redemption, require no payment card and never renew into paid access automatically. Customer coupons do not pay provider bills; verify infrastructure capacity/terms without weakening acceptance criteria.

## Tester coupons

Testers use the normal authorized subscription/entitlement path with the agreed discount. Stripe supports subscription coupons and customer-facing promotion codes; use its supported flow rather than a client-side price override. The user supplies or approves the actual offers. [Stripe coupons and promotion codes](https://docs.stripe.com/billing/subscriptions/coupons).

Accepted: 100% subscription discount for 30 days from redemption, no card required, one tester discount per invited workspace and no automatic paid renewal. Extensions require the user's approval; repeated redemption cannot restart the period. Display the exact end date during signup and in billing settings. Keep the code's redemption deadline (still open) separate from the redeemed discount's 30-day duration. Implement and test an explicit end-of-test subscription transition that prevents charging without paid opt-in; coupon expiry alone is not the cancellation mechanism. Paid continuation clearly shows price/interval, collects payment details and records the customer's explicit choice.

At tester expiry, block new hosting and preserve read-only work/permitted exports without broadening permissions. Session content lasts 90 days after session end unless deleted earlier. Reusable agendas/templates/resources persist under active entitlement and become read-only/exportable/recoverable for 90 days after entitlement ends, with deletion warnings. Reactivation during that period restores reusable-content editing, never already-expired participant records. The platform owner's non-expiring entitlement does not enter this expiry path. Already-running sessions can finish within four hours of original start without deadline resets. Detailed late-admission behavior remains open.

P6-03 must prove valid/invalid/expired/ineligible/exhausted codes, concurrent redemption, duplicate Checkout, zero-total subscription activation, no-charge expiry without opt-in and explicit paid continuation in Stripe's test environment. Do not require a positive payment as the only entitlement signal; verify authoritative subscription/invoice state and entitlement policy. Include a tester with an existing saved payment method in the no-charge expiry tests. Separate test/live codes; actual offers, live activation and real charges need their applicable authority. Do not create additional infrastructure charges.

Still settle numeric price/currency/allowances, ordinary paid renewal authorization details, refunds, billing-data retention, selling entity/country and applicable tax configuration. Annual billing and interval changes are deferred. One paid plan is accepted; additional tiers and metered overages are not agreed.

Accepted ordinary paid lifecycle: cancellation stops the next renewal and retains access through the already-paid period, followed by the agreed read-only recovery period. Existing paid customers receive seven days to resolve a failed renewal, with clear notices; after grace expires, block new hosting. An already-running session may finish within its original four-hour limit. Specify one authoritative grace deadline so retrying payments or delivering duplicate events cannot extend it. Tester expiry remains a separate no-charge/no-automatic-renewal policy. Data retention remains separate from billing status.

## Implementation contract

- Follow [COMMUNICATIONS.md](COMMUNICATIONS.md) for transactional billing notices. P6-03 assigns and tests one email owner per event, favoring supported Stripe-native notices; Debrio owns in-app access status and any required email gaps. Send financial notices only to authorized workspace billing contacts, never all workshop participants.
- Stripe is authoritative for billing records; Debrio stores a scoped, reconciled entitlement view for enforcing the accepted plan. Keep subscription status separate from workshop roles, resource grants and media-room permissions. Billing administrators do not automatically gain access to private participant work.
- Authenticate and authorize Checkout and portal creation against the workspace. Resolve the customer ID and allowed Price on the server; do not trust client-supplied ownership, amounts or entitlement claims. Prevent concurrent/retried requests from creating duplicate workspace subscriptions.
- Keep secret keys server-side. Verify webhook signatures against the original raw request body. Handle duplicate deliveries and out-of-order events, durable retry/reconciliation and concurrent updates without stale access restoration. Acknowledge only after processing or durable acceptance; do not rely on work continuing after a Vercel response. Stripe documents retries, signature checks and event ordering in its [webhook guide](https://docs.stripe.com/webhooks).
- A success redirect alone never proves payment. Specify access for incomplete, trialing, active, past-due, unpaid, canceled and other applicable states and for delayed payment confirmation. Pin and test the selected Stripe API/SDK versions at implementation time.
- Keep test and live credentials, customer/Price IDs, webhook secrets and evidence separate. Use hosted collection so Debrio does not handle raw card details. Keep secrets, payment data and unnecessary webhook payloads out of logs and demo videos.

## Delivery and proof

P2-01 proves one-person onboarding, workspace ownership and one account belonging to multiple workspaces through an explicit switcher. Each workspace retains separate content, permissions, subscriptions and exemption status; switching workspace cannot carry another workspace's billing authority or entitlements. P6-03 must demonstrate an individual subscriber completing Checkout and using the portal with no company/team requirement, as well as the organisation path; validate the selected Checkout settings during implementation. P5-01 covers the solo owner's prepare/admit/run/review flow. A one-person staff workspace does not impose a one-participant session or change the 20-person pilot recruitment minimum.

P0-02 owns billing architecture; P6-03 accepts initial commercial/coupon policy after feasibility evidence, implements the complete flow and records test-environment and synthetic-demo evidence before P5-03 tester readiness. P5-03 also requires the explicitly authorized tester environment and actual coupon configuration to match that evidence. P7-02 rechecks the release candidate; P7-03 verifies approved live configuration without an unapproved real charge.

Account closure must resolve ownership independently in every workspace and reconcile the authorized subscription cancellation without cascading into another workspace's shared work. Test failed/interrupted closure and recovery across identity, content and Stripe.

Required cases: initial purchase and authentication challenge, abandoned/failed checkout, renewal success/failure/recovery, cancellation at the accepted time, any supported plan changes, trial expiry if offered, duplicate/reordered/delayed webhooks, reconciliation after outage, concurrent checkout, cross-workspace portal denial, and the accepted in-progress-session policy. Use Stripe-supported test tools for lifecycle proof; mocks alone do not establish integration readiness.

No account configuration, products, prices, keys, charges, subscriptions or deployments were created by this planning update.
