# Data Protection Impact Assessment — Liveness Verification — DRAFT

> **This is a technical working draft prepared for a Data Protection Officer / privacy counsel to complete and formally sign off, not a completed DPIA.** GDPR Article 35 requires this assessment before processing that is "likely to result in a high risk to the rights and freedoms of natural persons" — biometric verification at scale squarely qualifies. This draft supplies the accurate, current *technical* facts a real DPIA needs (verified against the actual codebase on 2026-09-18, cited to specific files); it does **not** supply the legal risk analysis, the residual-risk sign-off, or consultation with the supervisory authority that a real DPIA requires. Do not treat this as evidence of GDPR Art. 35 compliance — it is preparatory material for the person who will actually complete that compliance step.

---

## 1. Systematic description of the processing

### 1.1 What the feature is

A liveness-verification step during signup, intended to confirm a real, live human is behind a new account rather than a bot or a stolen-photo account.

### 1.2 Nature of the processing — described precisely, not generically

| Question | Real, current answer | Source |
|---|---|---|
| Is a camera image/video actually captured from the user? | Not today. Only a mock provider (`MockLivenessProvider`) is wired in; it returns a synthetic "pass" with **zero real capture, zero real biometric analysis**. This DPIA must be completed and signed off **before** a real vendor is connected — that is the explicit gate this document exists to satisfy. | `backend/src/modules/verification/liveness/mock-liveness.provider.ts` |
| What would a real vendor integration capture? | Not yet decided (vendor not chosen — `docs/product.md` §17). Whatever the real vendor does on its own side, by explicit architectural design **this app's own backend must never receive or store raw capture frames** — the interface contract for any real provider is deliberately restricted to a pass/fail result plus an opaque provider reference. | `backend/src/modules/verification/liveness/liveness-provider.interface.ts` |
| What is actually stored, today, as a result of a liveness attempt? | A `LivenessSession` row: an internal ID, the user ID, a provider name string, an opaque provider reference string, a status enum (pending/pass/fail), and two timestamps. **No image, no video, no face embedding, no biometric template of any kind.** | `backend/prisma/schema.prisma` (`LivenessSession` model) |
| What is the durable, permanent effect of a pass? | A single boolean (`User.livenessStatus`) is set to `true`, plus a timestamp. This is the **only** application-level consequence of a liveness pass anywhere in the codebase. | `backend/src/modules/verification/verification.service.ts` |
| Does this boolean ever get reset or re-checked? | **No — confirmed by reading every write site in the codebase.** Once set to `true`, it stays `true` permanently, with no expiry and no re-verification requirement, regardless of what happens to the account afterward (including uploading different photos later). | Same file; cross-checked against a repo-wide search for every place `livenessStatus` is written |
| Is the "verified" badge shown to other users based on this same boolean? | Yes, directly and unconditionally, at five separate places in the codebase (discovery cards, matches, chat, AI search results, "who liked me"). | `deck.service.ts`, `who-liked-me.service.ts`, `match.service.ts`, `conversation.service.ts`, `ai-search.service.ts` |
| Is there any comparison between the liveness result and later-uploaded profile photos? | **No. Confirmed by direct code inspection — there is no face-comparison, embedding-similarity check, or any identity-binding logic anywhere in the codebase.** The one embedding/vector-comparison capability that does exist in this app is used exclusively for bio *text* semantic search and is never invoked in the photo-upload path. | `backend/src/modules/profile/profile.service.ts` (photo upload: malware scan, format re-encode, content moderation only — none identity-related) |

### 1.3 Purpose of the processing

Stated purpose: reduce fake/bot accounts and catfishing by confirming a real human created the account. **A DPO/lawyer completing this DPIA should explicitly weigh §1.2's findings against this stated purpose**: since there is no identity-binding to later photos, the control as currently designed proves "a live human created this account at signup," not "the person in these photos is a real, consistently-verified human" — the latter is the stronger claim a "verified" badge tends to imply to end users, and the gap between the two is a real finding of this technical review, not a hypothetical.

## 2. Necessity and proportionality assessment

**[FOR DPO/LEGAL COMPLETION]** — technical inputs to that assessment:

- **Data minimization, as currently designed, is genuinely strong**: no raw capture is retained, no biometric template is stored, and the entire liveness subsystem today (mock provider) processes zero real biometric data. This is a real, verifiable architectural fact, not a policy promise — confirmed by reading the code, not assumed from documentation. If a real vendor is integrated in a way that preserves this "result-only, zero local retention" contract, the on-platform data-minimization posture for liveness itself would remain strong.
- **What still needs a necessity/proportionality judgment call from counsel, not engineering**: (a) whether a real biometric liveness check is a proportionate measure at all for this product's actual risk profile, versus a lighter-weight alternative; (b) whether the current identity-binding gap (§1.3) means the processing, as designed, doesn't actually achieve enough of its stated purpose to justify processing special-category data under GDPR Article 9 in the first place — if the check doesn't meaningfully prevent catfishing (since a photo can be swapped freely after the one-time check), that weakens the necessity argument for doing biometric processing at all, or strengthens the case for adding real photo-identity binding (which itself would be new, additional special-category processing requiring its own fresh analysis — see §5).

## 3. Risk assessment

| Risk | Likelihood (as currently built) | Severity if realized | Technical mitigation already in place | Residual risk — **[FOR LEGAL/DPO JUDGMENT]** |
|---|---|---|---|---|
| Raw biometric capture data breach | None today (no real capture occurs — mock provider only) | N/A while mocked; would need fresh assessment once a real vendor is chosen | Zero-retention-by-design interface contract for any future real provider | Must be re-assessed the moment a real vendor is selected, using that vendor's actual data-handling terms — this DPIA's "no risk" conclusion is only valid for the current mock state |
| Catfishing / impersonation via a stolen or fake photo, post-verification | **Real and confirmed reachable today** — trivially so, since the mock provider auto-passes every session | Meaningful — this is a dating product where users make real-world safety decisions based partly on the "verified" signal | None. This is an explicit, acknowledged, currently-unmitigated gap | This is the single most important open item for legal/product judgment in this DPIA: whether to (a) accept and clearly disclose the limitation, (b) build real identity-binding (itself new Art. 9 processing — see §5), or (c) remove/rename the "verified" badge to avoid overstating what it proves |
| Function creep (liveness data used for something beyond its stated purpose) | Low, structurally — the interface contract makes broader use difficult by design (no raw data exists to misuse) | Would be high if it occurred | Interface-level restriction (§1.2) | Should be confirmed as an explicit organizational policy, not just a code-level accident of the current design |
| Vendor-side risk once a real liveness provider is integrated | Not yet applicable (unmocked) | Potentially high — a real vendor could process raw video, retain it, or share it with additional sub-processors | None yet — no vendor chosen | **This DPIA cannot be finalized until a real vendor is selected and its own data-processing terms are reviewed** — vendor selection and DPIA completion are coupled, not sequential-then-forgotten |

## 4. Consultation

**[FOR LEGAL/DPO COMPLETION]** — GDPR Art. 35(9) expects the views of data subjects (or their representatives) to be sought where appropriate. Not addressed in this technical draft.

## 5. A structural note for whoever completes this DPIA

If any future engineering work adds real face-matching (comparing an uploaded photo against a biometric reference derived from the liveness check, to close the gap in §1.3/§3), **that is not a fix to be scoped and shipped as a normal engineering backlog item** — it is a new, distinct instance of special-category biometric processing under GDPR Article 9, requiring its own lawful-basis, consent-wording, and retention analysis before a single line of that code is written, per the same logic that requires this DPIA in the first place. This note exists so that a future "let's just add face-matching" decision doesn't bypass legal review by being framed as a small technical improvement.

## 6. Sign-off

**[NOT SIGNED OFF. This section is empty by design.]** A real DPIA requires: a named DPO or equivalent responsible party, documented consultation with that party, a documented residual-risk decision, and (if residual risk remains high after mitigation) prior consultation with the supervisory authority per GDPR Art. 36. None of that has happened; this document is preparatory technical input only.

---

*Prepared as a technical-accuracy starting point, verified against the real codebase, for whoever formally owns this DPIA — not a substitute for that person's own legal and risk-management judgment.*
