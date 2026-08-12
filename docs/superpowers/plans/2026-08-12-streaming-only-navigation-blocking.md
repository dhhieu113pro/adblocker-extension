# Streaming-Only Navigation Blocking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent navigation blocking from interfering with links on normal sites; apply it only to streaming/ad-prone sites.

**Architecture:** Reuse the existing `isStreamingOrAdProneSite` checks. Gate main-world click and popup interception in `src/inject.ts`, and remove the non-streaming popup branch in `src/background.ts`. Visual ad hiding remains unchanged.

**Tech Stack:** TypeScript, Chrome extension APIs, Parcel.

---

### Task 1: Limit main-world navigation blocking

**Files:**
- Modify: `src/inject.ts:25-33,149-171`

- [ ] **Step 1: Gate page click blocking**

Change the standard link check from:

```ts
if (isAdUrl(href, isStreaming)) {
```

to:

```ts
if (isStreaming && isAdUrl(href, true)) {
```

This leaves normal-site links untouched and preserves heuristic blocking on streaming sites.

- [ ] **Step 2: Gate normal-site popup checks**

Change `shouldBlockRedirect` so it returns `false` for non-streaming sites:

```ts
return isStreaming && (isAdUrl(targetUrl, true) || isExternalAdUrl(targetUrl));
```

- [ ] **Step 3: Build the extension**

Run:

```powershell
npm run build
```

Expected: Parcel completes successfully and produces `dist/`.

### Task 2: Limit background popup blocking

**Files:**
- Modify: `src/background.ts:445-450`

- [ ] **Step 1: Remove the normal-site branch**

Replace the current conditional with:

```ts
const shouldBlock =
  isStreamingOrAdProneSite(sourceUrl, details.sourceTabId) &&
  isExternalAdUrl(details.url, sourceUrl);
```

- [ ] **Step 2: Build the extension**

Run:

```powershell
npm run build
```

Expected: Parcel completes successfully.

### Task 3: Review the resulting diff

**Files:**
- Review: `src/inject.ts`, `src/background.ts`, and the design/plan documents.

- [ ] **Step 1: Confirm scope**

Run:

```powershell
git diff -- src/inject.ts src/background.ts
```

Expected: only streaming-site navigation gates changed; visual ad hiding and category detection are untouched.
