# Hamava — Master Execution Checklist (Legal, Business, Technical, Launch)

> **This is not legal, tax, or financial advice.** It is a checklist of areas to cover, compiled to reduce the risk of missing something — not a substitute for a startup lawyer, a data-protection lawyer, a tax advisor, and (given the Iran-connected user base) sanctions/export-control counsel. Get professional sign-off on Parts A, B, C, D, and especially E before registering the company or processing any real user data.

---

## Part A — Business & corporate structure

- [ ] Choose legal entity type (e.g., GmbH in Germany, or an equivalent limited-liability form in another EU state — Netherlands BV, Estonia OÜ, Ireland Ltd, etc.)
- [ ] **Important nuance:** GDPR and the Digital Services Act (DSA) are EU-wide regulations — they apply the same way regardless of which member state you incorporate in. What actually varies by country: incorporation speed/cost, minimum share capital, corporate tax rate, ease of opening a business bank account, and general bureaucracy. Choose the jurisdiction for *those* reasons, with a corporate lawyer, not because you believe it lets you skip data-protection or platform-safety obligations — it won't.
- [ ] Register the company with the local commercial register (Handelsregister in Germany, or equivalent)
- [ ] Obtain a tax ID / VAT registration
- [ ] Open a business bank account (some EU countries require an in-person visit or a local resident director — confirm before committing to a jurisdiction)
- [ ] Appoint a registered legal representative (Geschäftsführer / managing director)
- [ ] Draft a founders'/shareholders' agreement if there's more than one founder
- [ ] Ensure all IP (code, brand, design) is formally assigned to the company, not held personally — via employment or contractor/IP-assignment agreements

---

## Part B — Data protection (GDPR) — this is the highest-stakes area for this product

Liveness verification and any biometric face-matching means you will process **special category data** under GDPR Article 9, which has a materially higher compliance bar than ordinary personal data.

- [ ] Conduct a **Data Protection Impact Assessment (DPIA)** before building the verification flow — mandatory under GDPR Art. 35 for large-scale biometric processing, and the single most important legal step for this specific product
- [ ] Establish and document the lawful basis for each category of data processed (explicit consent is the most likely basis for biometric verification; document it properly, don't assume it)
- [ ] Appoint a **Data Protection Officer (DPO)** — very likely required given the scale and sensitivity of data processed; confirm the exact trigger threshold with counsel
- [ ] Draft a full GDPR-compliant Privacy Policy (what's collected, why, lawful basis, retention period, third parties, user rights)
- [ ] Sign a **Data Processing Agreement (DPA)** with every vendor that touches user data: cloud host, liveness/KYC vendor, SMS/OTP provider, analytics tools, customer support tools, email provider — no exceptions
- [ ] Implement data retention & deletion in the product itself, not just on paper (this connects directly to the technical architecture already specified — biometric images deleted immediately post-verification, full account purge on deletion request)
- [ ] If any vendor or server is outside the EU/EEA, put a valid cross-border transfer mechanism in place (Standard Contractual Clauses, or confirm an adequacy decision covers that country)
- [ ] Cookie/tracking consent mechanism compliant with the ePrivacy Directive
- [ ] Prepare a **data breach response plan** — GDPR requires notifying the relevant supervisory authority within 72 hours of becoming aware of a breach, and affected users "without undue delay" if there's high risk to them
- [ ] Register with the national Data Protection Authority if your chosen member state requires it

---

## Part C — Digital Services Act (DSA) & platform obligations

- [ ] Terms of Service / Community Guidelines drafted to meet DSA transparency requirements (clear rules, consistent enforcement, accessible language)
- [ ] Notice-and-action mechanism for illegal content/user reports, with a documented appeals process
- [ ] Transparency reporting obligations — lighter at small scale, but design the reporting/moderation pipeline (already specified in the product brief's admin/moderation dashboard) so it can produce this data later without a rebuild
- [ ] If the user base later crosses the EU's "Very Large Online Platform" threshold, additional systemic-risk-assessment obligations apply — not an MVP concern, but worth knowing the trigger exists

---

## Part D — Dating-platform-specific legal considerations

- [ ] **Age verification, not just liveness.** Liveness proves a live human is behind the camera; it does not by itself prove the person is 18+. A dating platform needs a distinct, documented age-assurance approach, and this deserves specific legal review given how central it is to a dating product's legal exposure.
- [ ] Consumer protection / distance-selling compliance for any paid subscription: clear pricing, right-of-withdrawal rules for digital subscriptions under EU consumer law, straightforward cancellation flow (a "one-click as hard to cancel as to subscribe" pattern is both good practice and increasingly a regulatory expectation)
- [ ] Explicit legal review of the biometric consent flow's wording — this is not a place to reuse generic privacy-policy boilerplate
- [ ] User-generated content liability position documented (what you're responsible for vs. what's covered by platform-liability protections, and under what conditions those protections apply)
- [ ] Anti-scam warning language reviewed with counsel — some jurisdictions are moving toward specific dating-platform safety disclosure expectations; confirm current status for your chosen country

---

## Part E — Cross-border & sanctions considerations (do not skip this — genuinely high-stakes and specialized)

Because the target user base explicitly includes Iran-based users, while the company itself would be EU-registered, this creates a layered compliance question that is **not something to guess on** — it needs dedicated sanctions/export-control counsel before any infrastructure or payment decisions are finalized:

- [ ] **US sanctions (OFAC) exposure via vendors, not just direct dealings.** Even though the company is EU-based, if any vendor in your stack is a US company or has significant US nexus — AWS, Google Cloud, Stripe, PayPal, Apple's or Google's US entities — that vendor's own compliance obligations can restrict or terminate service related to Iran-connected usage, independent of what EU law itself requires of you. This has practically shut down or restricted services for other Iran-facing platforms before, sometimes with little warning.
- [ ] **EU's own Iran sanctions regime** is narrower than US sanctions (targeted at specific entities/sectors rather than a blanket restriction on providing a consumer app), but "narrower" is not "absent" — get this confirmed in writing by counsel, not assumed from general knowledge.
- [ ] App-store distribution reality check: Apple and Google already restrict or complicate direct app availability in Iran through their own policies (independent of government sanctions in some cases) — this is part of why domestic Iranian app stores (Cafe Bazaar, Myket) exist as the primary distribution channel there. Plan distribution strategy (EU/diaspora via official app stores, Iran via domestic stores and/or PWA) with this in mind from the architecture stage, not as an afterthought.
- [ ] Payment processing for Iran-based users specifically needs its own review — mainstream EU/global processors may decline or restrict this segment; confirm directly with any processor you're evaluating before building monetization around it.
- [ ] **Recommendation:** engage a lawyer with specific US/EU sanctions and export-control experience — this is a narrow specialty, not something a general corporate or GDPR lawyer will necessarily have deep expertise in — before finalizing your infrastructure vendor list or payment strategy.

---

## Part F — Intellectual property & branding

- [ ] Trademark search and registration for the final brand name, in the EU and any other markets you plan to operate in
- [ ] Domain registration (.com plus relevant country-code domains)
- [ ] Confirm no conflict with existing marks in the dating/social app space before committing to a final name

---

## Part G — Insurance & risk management

- [ ] Cyber liability insurance (materially important given biometric and PII processing)
- [ ] General commercial liability insurance
- [ ] Directors & Officers (D&O) insurance if/when raising outside investment

---

## Part H — Vendor & infrastructure accounts (practical setup list)

- [ ] Cloud hosting account with EU data-residency region selected (AWS/GCP/Azure or an EU-based alternative)
- [ ] Liveness/KYC vendor account, contract, and signed DPA
- [ ] SMS/OTP provider account for phone verification
- [ ] Payment processor account — confirm Iran-related usage policy directly with the provider before integration (see Part E)
- [ ] Apple Developer account (organization accounts require a DUNS number — apply early, it can take time) and Google Play Developer account
- [ ] Business email, domain, and basic operational tooling

---

## Part I — Technical build

Covered in detail in the companion document `hamava-project-brief.md` (Sections 7–14: feature set, architecture, data model, MVP scope, docs-first workflow). Bring both documents into the new project together.

---

## Part J — Pre-launch checklist

- [ ] Privacy Policy, Terms of Service, and Cookie Policy live and legally reviewed
- [ ] DPIA completed and formally signed off
- [ ] Independent security review / basic penetration test completed, given the sensitivity of biometric data
- [ ] Age-assurance mechanism tested and documented
- [ ] Moderation/report pipeline staffed or actively monitored — do not launch with an unmonitored report queue
- [ ] Business bank account and payment processor fully operational
- [ ] App store developer accounts approved (start this early — review/approval can take weeks)

---

## Part K — Ongoing compliance (post-launch, recurring)

- [ ] Periodic DPIA review whenever a feature changes how biometric or sensitive data is handled
- [ ] Regular data-breach-response drills, not just a document that's never tested
- [ ] DSA transparency reporting once applicable at your scale
- [ ] Re-review sanctions exposure periodically — sanctions regimes change, sometimes with short notice
- [ ] Legal review refresh as the user base grows or crosses into new jurisdictions

---

## Bottom line

The technical build (previous brief) is the part I can genuinely help you execute in a Claude Code project, step by step. **Parts A, B, C, D, and E of this checklist need real professional sign-off before you register the company or process a single real user's biometric data** — not because of bureaucratic caution, but because the consequences of getting biometric-data handling or sanctions exposure wrong in this specific product are severe and not easily reversible after the fact. Treat the legal track and the technical track as parallel workstreams from day one, not something to figure out after the app is built.
