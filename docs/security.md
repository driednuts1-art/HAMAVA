# Security Checklist

The living, tracked expansion of `product.md` §5's security principles into concrete, owned action items — this is the file that section was always meant to grow into (`product.md` §18: "security.md ← the Section 5 principles, expanded with implementation detail"). Chat conversation is not durable; this file is. Update status here as items move, don't let this drift out of sync with reality.

**Status legend:** 🔴 Not started · 🟡 Partially in place · 🟢 Done

---

## 1. Automated dependency-vulnerability scanning

**Status:** 🔴 Not enabled.

- **Source:** `product.md` §5 "Dependency & supply-chain security: automated dependency scanning (Dependabot/Snyk) on every build; block merges on critical CVEs"; reiterated in §10 as a distinct security-testing pass, not folded into general QA.
- **Action:** enable GitHub Dependabot alerts + security updates on the repository (free, no vendor decision needed to start), or Snyk if broader scanning is wanted later.
- **Trigger:** **now** — this has no dependency on production infra, a hosting decision, or legal sign-off. There's no reason for this to wait until launch prep; it should have been on from the first commit.
- **Owner note:** requires the project to actually be pushed to a git remote (GitHub) first — this backend has been developed locally against Neon without a git remote set up yet. Confirm that's in place, then enable.

## 2. Real secrets manager before production

**Status:** 🔴 Not in place — currently `.env` (explicitly dev-only; see the "never in environment files committed to source control" line in `product.md` §5).

- **Source:** `product.md` §5 "Secrets management: all API keys, DB credentials, and third-party tokens stored in a dedicated secrets manager (e.g. AWS Secrets Manager, HashiCorp Vault, or GCP Secret Manager) — never in environment files committed to source control."
- **Current state:** `backend/.env` holds `DATABASE_URL`, JWT/HMAC secrets, etc. It is gitignored (`backend/.gitignore`), so it isn't committed — but a gitignored `.env` file is still not a secrets manager: no access control, no rotation, no audit log of who read what.
- **Trigger:** **must be resolved before any production deployment or before any real (non-test) user data is processed.** Not a launch-week task — factor the migration off `.env` into whichever infra/hosting decision closes `product.md` §17's open items.
- **Action when scoped:** pick a manager (AWS Secrets Manager / HashiCorp Vault / GCP Secret Manager per the product.md suggestion, or whatever matches the eventual hosting decision), migrate every secret currently in `.env`, and update `ConfigModule` wiring accordingly — no application code should need to change beyond how config values are sourced.

## 3. Third-party penetration test before public launch

**Status:** 🔴 Not scheduled.

- **Source:** `product.md` §5 "Independent security review: third-party penetration test before public launch, and after any major architecture change (e.g., adding the calling infrastructure)"; `legal-checklist.md` Part J (pre-launch checklist) and Part K (recurring — "given the sensitivity of biometric data").
- **Trigger:** before any public launch. **Also** required again after any major architecture change — the calling infrastructure (in-app voice/video, still upcoming per `docs/roadmap.md`) is explicitly named as one such trigger in `product.md` §5.
- **Note:** this is in addition to, not instead of, the automated dependency scanning in item 1 — `product.md` §10 treats these as two distinct passes, not substitutes for each other.

## 4. Production security headers, WAF, and DDoS protection

**Status:** 🟡 Partially in place.

- **Source:** `product.md` §5 API security baseline: "secure headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy)".
- **Already done in code:** `app.use(helmet())` in `backend/src/main.ts` applies CSP, HSTS, X-Content-Type-Options, and helmet's other default protections on every response, today — this part isn't waiting on a production decision.
- **Still missing:** WAF and DDoS protection are infrastructure-layer, not application-layer — they depend on the hosting/CDN choice, which is still an open decision (`product.md` §17: "Hosting jurisdiction, cloud provider, and data residency approach"). Cannot be finalized until that's decided.
- **Trigger:** WAF/DDoS piece must be in place before production deployment; the application-layer headers are already shipping.

## 5. Data breach response plan (GDPR)

**Status:** 🔴 Not drafted.

- **Source:** `legal-checklist.md` Part B: "Prepare a data breach response plan — GDPR requires notifying the relevant supervisory authority within 72 hours of becoming aware of a breach, and affected users 'without undue delay' if there's high risk to them." Part K adds this needs **regular drills**, not a document that's written once and never tested.
- **Trigger:** before processing any real (non-test) user data — this sits alongside the DPIA as a pre-condition for handling real biometric/personal data, not a nice-to-have.
- **Note:** per `legal-checklist.md`'s own framing, this needs a data-protection lawyer, not just engineering — flagging here so it isn't lost, not attempting to draft it as an engineering artifact.

---

## Review cadence

This list isn't "write once, forget" — re-check it:
- Whenever a new feature touches data sensitivity (biometric, payment, messaging content).
- Before any production deployment (items 2 and 4's WAF/DDoS piece are hard blockers for that).
- Before public launch (item 3, and item 5 as a precondition to processing real data at all).
- On the recurring cadence `legal-checklist.md` Part K already establishes for the legal-adjacent items (3 and 5).
