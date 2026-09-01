# Hybrid Ad Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ad blocking deterministic-first and conservative, while using a fast visual AI stage plus a context-review AI stage for genuinely ambiguous content.

**Architecture:** Existing network/filter rules remain the cheapest blocking layer. `image-ad-policy.mjs` becomes an evidence/decision policy that separates explicit ad evidence, trusted/normal evidence, and ambiguity; `content.js` sends only ambiguous candidates through AI and escalates inconclusive results to context review. Uncertain results remain visible.

**Tech Stack:** Chromium Manifest V3, JavaScript/TypeScript, Node.js test runner, `@xenova/transformers` CLIP/WebLLM inference, Parcel.

**Spec:** `docs/superpowers/specs/2026-09-01-hybrid-ad-detection-design.md`

## Global Constraints

- Reuse existing network blocking and AI infrastructure.
- Do not implement the full uBlock Origin filter language in this change.
- Image dimensions alone must never prove that an image is an ad.
- Arbitrary URL substring matches such as `qc`, `ads`, or `game` inside signed/query tokens must never prove that an image is an ad.
- Strong deterministic evidence may block without AI.
- Remaining uncertainty must keep content visible.
- Preserve `npm test` and 100% policy-module coverage requirements.

---

### Task 1: Conservative deterministic image evidence

**Files:**
- Modify: `src/image-ad-policy.mjs`
- Modify: `tests/image-ad-policy.test.mjs`

**Interfaces:**
- Consumes: current image metadata passed by `content.js`.
- Produces: conservative `shouldAutoAnalyzeImageCandidate(...)` behavior and named confidence policy helpers used by later tasks.

- [ ] **Step 1: Write failing regressions** for a normal `i.ytimg.com` thumbnail whose signed query contains `qc`, a generic CDN URL containing `ads` in an opaque token, and a normal editorial image sized 300x250; assert none is automatically treated as an ad candidate solely for those reasons.
- [ ] **Step 2: Run `npm test`** and verify the new cases fail against the current broad marker/IAB-size policy.
- [ ] **Step 3: Replace broad evidence** with parsed host/path evidence and explicit DOM/link signals. Preserve known ad-network and explicit sponsored/overlay detection; dimensions become metadata only.
- [ ] **Step 4: Add boundary tests** proving explicit `sponsored`, explicit ad-close/overlay markers, and known ad-network URLs remain candidates.
- [ ] **Step 5: Run `npm test && npm run test:coverage`** and require both to pass.
- [ ] **Step 6: Commit** as `fix: make image ad evidence conservative`.

### Task 2: AI confidence zones and escalation policy

**Files:**
- Modify: `src/image-ad-policy.mjs`
- Modify: `tests/image-ad-policy.test.mjs`

**Interfaces:**
- Produces: `classifyAiDecision(result, thresholds)` returning `block`, `allow`, or `review`.
- Default thresholds: block at confidence >= 85, allow a non-ad result or low ad confidence <= 30, otherwise review.

- [ ] **Step 1: Write failing threshold tests** for 29/30/31, 84/85/86 confidence boundaries and non-ad results.
- [ ] **Step 2: Run `npm test`** and verify failure because the three-zone helper does not exist.
- [ ] **Step 3: Implement the minimal pure helper** with named default thresholds `{ allowMax: 30, blockMin: 85 }` and no DOM/runtime dependencies.
- [ ] **Step 4: Run `npm test && npm run test:coverage`** and require both to pass.
- [ ] **Step 5: Commit** as `feat: add conservative AI decision zones`.

### Task 3: Context-review second AI stage

**Files:**
- Modify: `src/content.js`
- Modify: `src/image-ad-policy.mjs`
- Modify: `tests/image-ad-policy.test.mjs`

**Interfaces:**
- Consumes: first AI result plus `pageUrl`, `imageUrl`, `linkUrl`, dimensions, `linkRel`, explicit DOM signals, and deterministic evidence.
- Produces: a second `detectAd` request carrying `contextReview: true` and structured evidence when the first result is `review`.

- [ ] **Step 1: Add failing pure-policy tests** for building a context-review payload without leaking arbitrary DOM text or unrelated page content.
- [ ] **Step 2: Run `npm test`** and verify the payload tests fail.
- [ ] **Step 3: Implement `buildContextReviewRequest(...)`** in the policy module and wire `content.js` so only middle-confidence Model A results request Model B/context review.
- [ ] **Step 4: Make the final decision conservative:** block only when the context-review result reaches the block threshold; otherwise leave the element visible.
- [ ] **Step 5: Run `npm test && npm run test:coverage && npm run build`** and require all commands to pass.
- [ ] **Step 6: Commit** as `feat: add context AI review for ambiguous ads`.

### Task 4: End-to-end regression coverage

**Files:**
- Modify/create under: `tests/` and existing Playwright fixtures/specs as appropriate.

**Interfaces:**
- Verifies the integrated browser behavior without changing production interfaces.

- [ ] **Step 1: Add a failing browser regression** rendering normal YouTube-style thumbnails and normal editorial/CDN images alongside explicit sponsored/ad fixtures.
- [ ] **Step 2: Run `npm run test:e2e`** and confirm the regression captures any remaining false-positive hiding.
- [ ] **Step 3: Make only the minimal runtime adjustments** needed for normal images to stay visible while explicit ads are hidden.
- [ ] **Step 4: Run `npm test && npm run test:coverage && npm run build && npm run test:e2e`** and require all suites to pass.
- [ ] **Step 5: Commit** as `test: cover hybrid ad detection end to end`.

### Task 5: Review and PR

**Files:**
- Review all changed files against the spec.

**Interfaces:**
- Produces a reviewable pull request from `feat/hybrid-ad-detection` to `main`.

- [ ] **Step 1: Compare branch to `main`** and verify there are no unrelated changes.
- [ ] **Step 2: Re-run the full validation commands** from Task 4 and record exact results.
- [ ] **Step 3: Create a PR** explaining the deterministic-first pipeline, two-stage AI behavior, YouTube/normal-image regression coverage, and performance/false-positive rationale.
- [ ] **Step 4: Check GitHub Actions** and fix failures before declaring the PR ready.
