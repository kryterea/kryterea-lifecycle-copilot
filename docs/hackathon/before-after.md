# Before and after: Demo merchant payments

Kryterea checked `a1c5df0` (before) and `18724e2` (after). Each side is the record as it stood while that commit was the latest one checked, decisions included.

| | Before | After | Change |
|---|---|---|---|
| Open items | 40 | 16 | 24 fewer |
| Evidence found | 5 | 20 | 15 more |
| Gaps | 3 | 3 | Same |
| No evidence | 16 | 5 | 11 fewer |

## Closed (29)

- Risk accepted: Missing account recovery and request limits leaves merchants locked out and exposed to takeover
- Fixed: Missing refund error handling leaves merchant unsure when refund call cannot complete
- Fixed: Unclear repeat pay start creates duplicate pending payments with no stated rule
- Fixed: Unclear customer recovery after amount mismatch leaves payment stuck with no retry
- Risk accepted: Missing link disable and expiry lets old links stay usable forever
- Risk accepted: Vague cancel token rules allow unclear access to cancel subscriptions
- Risk accepted: Conflicting renewal notice promise creates unclear scope for email alerts
- Risk accepted: Incomplete subscription amount rules leave plan limits and validation undefined
- Fixed: \[failure\_path\] Unclear repeat pay start creates duplicate pending payments with no stated rule
- Fixed: \[failure\_path\] Unclear customer recovery after amount mismatch leaves payment stuck with no retry
- Risk accepted: Check this: Lawful basis for merchant and customer data uses
- Risk accepted: Check this: Privacy notice before signup and pay collection
- Risk accepted: Check this: Retention period for merchant and payment records
- Risk accepted: Check this: Access to personal data and copies
- Risk accepted: Check this: Correction and deletion of personal data
- Risk accepted: Check this: Written terms with Paystack and hosting providers
- Risk accepted: Check this: Incident logging and reporting plan
- Risk accepted: Check this: Protection of pay page that embeds Paystack form
- Fixed: Login and pay endpoints can be hammered with no slowdown
- Fixed: Not in any document: \[failure\_path\] Unclear repeat pay start creates duplicate pending payments with no stated rule
- Fixed: Not in any document: \[failure\_path\] Unclear customer recovery after amount mismatch leaves payment stuck with no retry
- Fixed: Not in any document: Silent webhook wait with no stated timing
- Fixed: Not in any document: Cross link reference guard with no written rule
- Risk accepted: \[operations\] All orders live in one server file with no backup
- Fixed: \[operations\] Double tap creates two pending payments with no way to tell which is real
- Fixed: \[operations\] Login and pay endpoints can be hammered with no slowdown
- Risk accepted: \[operations\] Owner has no alert when the app or payments break at night
- Risk accepted: \[operations\] One shared database file will slow first under ten times load
- Risk accepted: \[operations\] Owner cannot find an old paid claim beyond the recent list

## New (5)

- Requirement PRD-2 has no evidence yet
- Requirement PRD-27 has no evidence yet
- Accepted risk needs review: Check this: Lawful basis for merchant and customer data uses
- Accepted risk needs review: \[operations\] Owner has no alert when the app or payments break at night
- Requirement PRD-30 has no acceptance criteria

## Still open (11)

- \[failure\_path\] Missing refund error handling leaves merchant unsure when refund call cannot complete
- All orders live in one server file with no backup
- Owner has no alert when the app or payments break at night
- One shared database file will slow first under ten times load
- Owner cannot find an old paid claim beyond the recent list
- Amount mismatch has no customer next step
- Monthly plan link not available
- Not in any document: \[failure\_path\] Missing refund error handling leaves merchant unsure when refund call cannot complete
- Not in any document: Automatic sign in after signup with no written rule
- Not in any document: Longer link code after collisions with no written rule
- Not in any document: Merchant profile check with no written rule

## Acceptance criteria that moved

- No evidence to Evidence found: PRD-1, PRD-7, PRD-9 Merchant sees a new shareable link within seconds after entering title and amount.
- No evidence to Evidence found: PRD-3, PRD-8 Merchant sees own links newest first with shareable URL for each on dashboard.
- No evidence to Evidence found: PRD-7 Merchant sees a clear message when amount is zero or above ten million naira.
- No evidence to Evidence found: PRD-11 Customer sees pay options after entering a valid email which creates a pending payment with unique reference.
- No evidence to Evidence found: PRD-12, PRD-14 Customer sees success screen and merchant sees paid status when Paystack reports success with matching amount.
- No evidence to Evidence found: PRD-12, PRD-13 Merchant sees paid status stay paid when verify is repeated for same reference.
- No evidence to Evidence found: PRD-11, PRD-25 Customer sees a clear rule when starting pay twice for same link without duplicate confusion.
- No evidence to Evidence found: PRD-17 Merchant sees a clear message when refund cannot complete due to missing transaction or service issue.
- No evidence to Evidence found: PRD-15 Merchant can still sign up and create links when Paystack keys are missing while pay shows service unavailable.
- No evidence to Evidence found: PRD-3, PRD-16 Merchant sees payments newest first capped at 200 with amounts in naira.
- No evidence to Evidence found: PRD-10, PRD-11 Customer enters email and taps Pay once and sees Paystack payment prompt for the link amount.
- No evidence to Evidence found: PRD-3, PRD-11, PRD-16, PRD-25 After tapping Pay twice for same email and link, merchant sees one pending payment for that sale in the dashboard.
- Evidence found to No evidence: PRD-12, PRD-14, PRD-27 When Paystack reports an unsuccessful charge, customer sees an unsuccessful message with a way to try again.
- Gap to Evidence found: PRD-12, PRD-26 When amount reported does not match link amount, customer sees guidance on what to do next instead of a stuck screen.
- Not checked to Evidence found: PRD-11, PRD-25 Second tap on Pay while one payment is pending reuses the same pending payment and does not create a second row
- Not checked to Gap: PRD-26 When amount confirmed does not match, pay page shows how to retry the same payment
- Not checked to Evidence found: PRD-29 Verify with a reference from another link is rejected with a clear message
- Not checked to Evidence found: PRD-28 Pending wait for verification shows timing and next step to customer and merchant

10 criteria unchanged.

Generated from the Kryterea record. Legal items are things to check, not legal advice.
