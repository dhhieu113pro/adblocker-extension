# Unified Chromium Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser-specific release tags with one `vX.Y.Z` release that builds one tested ZIP and reuses it for GitHub Releases, Microsoft Edge Add-ons, and the Chrome Web Store; Brave consumes the Chrome listing and generic Chromium consumes the GitHub ZIP/manual build.

**Architecture:** `.github/workflows/release.yml` becomes the only tag-triggered orchestrator. It validates the tag against `src/manifest.json` and `package.json`, runs tests and the production build once, packages `dist/` once, and uploads that ZIP as a workflow artifact. Reusable Edge and Chrome store workflows download the exact artifact rather than rebuilding it.

**Tech Stack:** Node.js 22, Node test runner, Parcel WebExtension build, Playwright Chromium, GitHub Actions reusable workflows, Microsoft Edge Add-ons Publish API, Chrome Web Store API v2, `google-github-actions/auth@v3`, `curl`, `jq`, `zip`/`unzip`.

**Spec:** `docs/superpowers/specs/2026-08-24-unified-chromium-release-design.md`

## Global Constraints

- One release identity only: manifest/package version `X.Y.Z`, Git tag `vX.Y.Z`.
- Do not create `-edge`, `-chrome`, `-brave`, or `-chromium` version/tag suffixes.
- Build and package `dist/` exactly once per release run.
- Publish the same ZIP bytes to GitHub Releases, Microsoft Edge Add-ons, and Chrome Web Store.
- Brave uses the Chrome Web Store listing; no Brave-specific workflow or credentials.
- Generic Chromium uses the GitHub Release ZIP or unpacked `dist/` in developer mode.
- Preserve the existing unit-test 100% coverage gate and installed-extension Playwright E2E test before packaging.
- Chrome publishing must use Chrome Web Store API v2 endpoints and OAuth scope `https://www.googleapis.com/auth/chromewebstore`.
- Keep existing Edge credentials: `EDGE_CLIENT_ID`, `EDGE_API_KEY`, `EDGE_PRODUCT_ID`.
- Chrome requires an existing store item; automation updates/publishes it but does not create the initial listing.
- Prepare the first unified release as version `1.0.12` after workflow changes pass.

---

## File Map

- `scripts/release-version.mjs` — pure release tag/version/artifact-name validation plus a CLI used by GitHub Actions.
- `tests/release-version.test.mjs` — unit tests for tag parsing, version mismatch failures, and deterministic artifact naming.
- `package.json` — adds `release:validate`; bumps project version to `1.0.12` in the final preparation task.
- `package-lock.json` — keeps npm package metadata aligned with `package.json` version `1.0.12`.
- `src/manifest.json` — bumps extension version to `1.0.12` in the final preparation task.
- `.github/workflows/release.yml` — the only `vX.Y.Z` tag trigger; build/test/package once; fans out to GitHub, Edge, and Chrome.
- `.github/workflows/edge-store.yml` — reusable Edge publishing workflow; no build/test/tag trigger.
- `.github/workflows/chrome-store.yml` — reusable Chrome Web Store API v2 publishing workflow.
- `docs/EDGE_STORE_PUBLISHING.md` — documents the unified tag and Edge credentials.
- `docs/CHROME_STORE_PUBLISHING.md` — documents one-time Chrome API/store setup and required GitHub secrets.
- `README.md` — describes the extension as Chromium-family compatible and lists the three distribution paths.

---

### Task 1: Add a Testable Release Contract

**Files:**
- Create: `scripts/release-version.mjs`
- Create: `tests/release-version.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseReleaseTag(tag: string): string`
- Produces: `validateRelease({ tag, manifestVersion, packageVersion }): { version, artifactName, packageFilename }`
- CLI: `npm run release:validate -- v1.0.12`
- CLI outputs to `$GITHUB_OUTPUT` when present: `version`, `artifact_name`, `package_filename`

- [ ] **Step 1: Write the failing release-contract tests**

Create `tests/release-version.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { parseReleaseTag, validateRelease } from "../scripts/release-version.mjs";

test("release tag must be exactly vX.Y.Z", () => {
  assert.equal(parseReleaseTag("v1.0.12"), "1.0.12");
  assert.throws(() => parseReleaseTag("v1.0.12-edge"), /vX\.Y\.Z/);
  assert.throws(() => parseReleaseTag("1.0.12"), /vX\.Y\.Z/);
  assert.throws(() => parseReleaseTag("v1.0"), /vX\.Y\.Z/);
});

test("manifest and package versions must match the release tag", () => {
  assert.deepEqual(
    validateRelease({
      tag: "v1.0.12",
      manifestVersion: "1.0.12",
      packageVersion: "1.0.12",
    }),
    {
      version: "1.0.12",
      artifactName: "ai-vision-ad-blocker-v1.0.12",
      packageFilename: "ai-vision-ad-blocker-v1.0.12.zip",
    },
  );

  assert.throws(
    () => validateRelease({ tag: "v1.0.12", manifestVersion: "1.0.11", packageVersion: "1.0.12" }),
    /manifest version 1\.0\.11 does not match release 1\.0\.12/,
  );

  assert.throws(
    () => validateRelease({ tag: "v1.0.12", manifestVersion: "1.0.12", packageVersion: "1.0.11" }),
    /package version 1\.0\.11 does not match release 1\.0\.12/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/release-version.test.mjs
```

Expected: FAIL because `scripts/release-version.mjs` does not exist.

- [ ] **Step 3: Implement the release contract and CLI**

Create `scripts/release-version.mjs`:

```js
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function parseReleaseTag(tag) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag ?? "");
  if (!match) {
    throw new Error(`Release tag must match vX.Y.Z exactly; received ${tag || "<empty>"}`);
  }
  return match[1];
}

export function validateRelease({ tag, manifestVersion, packageVersion }) {
  const version = parseReleaseTag(tag);

  if (manifestVersion !== version) {
    throw new Error(`manifest version ${manifestVersion} does not match release ${version}`);
  }
  if (packageVersion !== version) {
    throw new Error(`package version ${packageVersion} does not match release ${version}`);
  }

  return {
    version,
    artifactName: `ai-vision-ad-blocker-v${version}`,
    packageFilename: `ai-vision-ad-blocker-v${version}.zip`,
  };
}

function main() {
  const tag = process.argv[2] || process.env.GITHUB_REF_NAME;
  const manifest = JSON.parse(readFileSync("src/manifest.json", "utf8"));
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const result = validateRelease({
    tag,
    manifestVersion: manifest.version,
    packageVersion: packageJson.version,
  });

  console.log(`Release version: ${result.version}`);
  console.log(`Artifact: ${result.packageFilename}`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${result.version}\nartifact_name=${result.artifactName}\npackage_filename=${result.packageFilename}\n`,
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
```

- [ ] **Step 4: Add the package script and run all unit tests**

Add to `package.json` scripts:

```json
"release:validate": "node scripts/release-version.mjs"
```

Run:

```bash
node --test tests/release-version.test.mjs
npm test
npm run test:coverage
```

Expected: all PASS; the existing 100% gate for `src/image-ad-policy.mjs` remains unchanged.

- [ ] **Step 5: Commit the release contract**

```bash
git add scripts/release-version.mjs tests/release-version.test.mjs package.json
git commit -m "test: define unified release version contract"
```

---

### Task 2: Make `release.yml` Build and Package Once

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `npm run release:validate -- "$GITHUB_REF_NAME"`
- Produces job outputs: `version`, `artifact_name`, `package_filename`
- Produces workflow artifact named `ai-vision-ad-blocker-vX.Y.Z` containing one file `ai-vision-ad-blocker-vX.Y.Z.zip`
- Calls reusable workflows from Tasks 3 and 4 with those exact inputs

- [ ] **Step 1: Replace the old tag/rebuild workflow with the unified orchestrator**

Use this structure in `.github/workflows/release.yml`:

```yaml
name: Unified Chromium Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.release.outputs.version }}
      artifact_name: ${{ steps.release.outputs.artifact_name }}
      package_filename: ${{ steps.release.outputs.package_filename }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Validate unified release version
        id: release
        run: npm run release:validate -- "$GITHUB_REF_NAME"

      - name: Run tests with 100% coverage gate
        run: npm run test:coverage

      - name: Build extension
        run: npm run build

      - name: Install Playwright test runner
        run: npm install --no-save --package-lock=false @playwright/test@1.55.0

      - name: Install Playwright Chromium
        run: npx playwright install --with-deps chromium

      - name: Run installed-extension E2E tests
        run: npm run test:e2e

      - name: Package and validate extension ZIP
        shell: bash
        env:
          VERSION: ${{ steps.release.outputs.version }}
          PACKAGE_FILENAME: ${{ steps.release.outputs.package_filename }}
        run: |
          set -euo pipefail
          mkdir -p release
          (cd dist && zip -qr "../release/$PACKAGE_FILENAME" .)

          zipinfo -1 "release/$PACKAGE_FILENAME" | grep -Fx 'manifest.json'
          ZIP_VERSION="$(unzip -p "release/$PACKAGE_FILENAME" manifest.json | jq -r '.version')"
          if [[ "$ZIP_VERSION" != "$VERSION" ]]; then
            echo "::error::ZIP manifest version $ZIP_VERSION does not match release $VERSION"
            exit 1
          fi

      - name: Upload unified package artifact
        uses: actions/upload-artifact@v4
        with:
          name: ${{ steps.release.outputs.artifact_name }}
          path: release/${{ steps.release.outputs.package_filename }}
          if-no-files-found: error
          retention-days: 30

  github-release:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Download unified package artifact
        uses: actions/download-artifact@v5
        with:
          name: ${{ needs.build.outputs.artifact_name }}
          path: release

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: release/${{ needs.build.outputs.package_filename }}
          generate_release_notes: true

  edge-store:
    needs: build
    uses: ./.github/workflows/edge-store.yml
    with:
      version: ${{ needs.build.outputs.version }}
      artifact_name: ${{ needs.build.outputs.artifact_name }}
      package_filename: ${{ needs.build.outputs.package_filename }}
    secrets:
      EDGE_CLIENT_ID: ${{ secrets.EDGE_CLIENT_ID }}
      EDGE_API_KEY: ${{ secrets.EDGE_API_KEY }}
      EDGE_PRODUCT_ID: ${{ secrets.EDGE_PRODUCT_ID }}

  chrome-store:
    needs: build
    uses: ./.github/workflows/chrome-store.yml
    with:
      version: ${{ needs.build.outputs.version }}
      artifact_name: ${{ needs.build.outputs.artifact_name }}
      package_filename: ${{ needs.build.outputs.package_filename }}
    secrets:
      CHROME_SERVICE_ACCOUNT_JSON: ${{ secrets.CHROME_SERVICE_ACCOUNT_JSON }}
      CHROME_SERVICE_ACCOUNT_EMAIL: ${{ secrets.CHROME_SERVICE_ACCOUNT_EMAIL }}
      CHROME_PUBLISHER_ID: ${{ secrets.CHROME_PUBLISHER_ID }}
      CHROME_EXTENSION_ID: ${{ secrets.CHROME_EXTENSION_ID }}
```

- [ ] **Step 2: Verify the old browser-specific condition is gone**

Run:

```bash
grep -R --line-number -- '-edge' .github/workflows/release.yml
```

Expected: no output.

Run:

```bash
grep -n "npm run build" .github/workflows/release.yml
```

Expected: exactly one match.

- [ ] **Step 3: Verify package validation is present**

Run:

```bash
grep -n "zipinfo\|ZIP_VERSION\|upload-artifact" .github/workflows/release.yml
```

Expected: lines showing root `manifest.json` validation, ZIP version validation, and artifact upload.

- [ ] **Step 4: Commit the orchestrator**

```bash
git add .github/workflows/release.yml
git commit -m "ci: build one package for chromium releases"
```

---

### Task 3: Convert Edge Publishing Into a Reusable Artifact Consumer

**Files:**
- Modify: `.github/workflows/edge-store.yml`

**Interfaces:**
- Consumes inputs: `version`, `artifact_name`, `package_filename`
- Consumes secrets: `EDGE_CLIENT_ID`, `EDGE_API_KEY`, `EDGE_PRODUCT_ID`
- Consumes the ZIP artifact created by `release.yml`; must not run `npm ci`, tests, Playwright, or `npm run build`

- [ ] **Step 1: Replace the `v*-edge` trigger with `workflow_call`**

Replace the top of `.github/workflows/edge-store.yml` with:

```yaml
name: Publish Microsoft Edge Store

on:
  workflow_call:
    inputs:
      version:
        required: true
        type: string
      artifact_name:
        required: true
        type: string
      package_filename:
        required: true
        type: string
    secrets:
      EDGE_CLIENT_ID:
        required: true
      EDGE_API_KEY:
        required: true
      EDGE_PRODUCT_ID:
        required: true

permissions:
  contents: read
```

- [ ] **Step 2: Replace build/test/package steps with artifact download and validation**

The Edge job must begin with:

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    env:
      EDGE_CLIENT_ID: ${{ secrets.EDGE_CLIENT_ID }}
      EDGE_API_KEY: ${{ secrets.EDGE_API_KEY }}
      EDGE_PRODUCT_ID: ${{ secrets.EDGE_PRODUCT_ID }}
      EDGE_API_ROOT: https://api.addons.microsoftedge.microsoft.com/v1
      PACKAGE: package/${{ inputs.package_filename }}

    steps:
      - name: Download unified package artifact
        uses: actions/download-artifact@v5
        with:
          name: ${{ inputs.artifact_name }}
          path: package

      - name: Validate Edge inputs and package
        shell: bash
        run: |
          set -euo pipefail
          for name in EDGE_CLIENT_ID EDGE_API_KEY EDGE_PRODUCT_ID; do
            if [[ -z "${!name:-}" ]]; then
              echo "::error::Missing GitHub Actions secret: $name"
              exit 1
            fi
          done
          test -f "$PACKAGE"
          PACKAGE_VERSION="$(unzip -p "$PACKAGE" manifest.json | jq -r '.version')"
          if [[ "$PACKAGE_VERSION" != "${{ inputs.version }}" ]]; then
            echo "::error::Edge package version $PACKAGE_VERSION does not match ${{ inputs.version }}"
            exit 1
          fi
```

Delete the old checkout, Node setup, `npm ci`, unit-test, build, Playwright, screenshot, tag-validation, and ZIP-packaging steps from this workflow.

- [ ] **Step 3: Point the existing Edge upload at `$PACKAGE`**

Use the existing API semantics, with the package path changed to the downloaded artifact:

```yaml
      - name: Upload package to Edge Add-ons
        id: edge_upload
        shell: bash
        run: |
          set -euo pipefail
          HEADERS="$(mktemp)"
          BODY="$(mktemp)"

          HTTP_CODE=$(curl --silent --show-error \
            --output "$BODY" \
            --dump-header "$HEADERS" \
            --write-out '%{http_code}' \
            -H "Authorization: ApiKey $EDGE_API_KEY" \
            -H "X-ClientID: $EDGE_CLIENT_ID" \
            -H "Content-Type: application/zip" \
            -X POST \
            --data-binary "@$PACKAGE" \
            "$EDGE_API_ROOT/products/$EDGE_PRODUCT_ID/submissions/draft/package")

          cat "$BODY"
          if [[ "$HTTP_CODE" != "202" ]]; then
            echo "::error::Edge package upload returned HTTP $HTTP_CODE"
            exit 1
          fi

          LOCATION=$(awk 'BEGIN{IGNORECASE=1} /^location:/ {gsub("\\r", "", $2); print $2}' "$HEADERS" | tail -n1)
          OPERATION_ID="${LOCATION##*/}"
          if [[ -z "$OPERATION_ID" ]]; then
            echo "::error::Edge package upload did not return a Location operation ID"
            cat "$HEADERS"
            exit 1
          fi
          echo "operation_id=$OPERATION_ID" >> "$GITHUB_OUTPUT"
```

- [ ] **Step 4: Keep validation polling and certification submission explicit**

Use these two polling/submission blocks after upload:

```yaml
      - name: Wait for Edge package validation
        shell: bash
        env:
          OPERATION_ID: ${{ steps.edge_upload.outputs.operation_id }}
        run: |
          set -euo pipefail
          for attempt in $(seq 1 60); do
            RESPONSE=$(curl --fail-with-body --silent --show-error \
              -H "Authorization: ApiKey $EDGE_API_KEY" \
              -H "X-ClientID: $EDGE_CLIENT_ID" \
              "$EDGE_API_ROOT/products/$EDGE_PRODUCT_ID/submissions/draft/package/operations/$OPERATION_ID")
            STATUS=$(jq -r '.status // empty' <<< "$RESPONSE")
            echo "Package validation [$attempt/60]: ${STATUS:-Unknown}"
            case "$STATUS" in
              Succeeded) echo "$RESPONSE" | jq .; exit 0 ;;
              Failed) echo "$RESPONSE" | jq .; exit 1 ;;
            esac
            sleep 10
          done
          echo "::error::Timed out waiting for Edge package validation"
          exit 1

      - name: Submit Edge draft for certification
        id: edge_submit
        shell: bash
        run: |
          set -euo pipefail
          HEADERS="$(mktemp)"
          BODY="$(mktemp)"
          NOTES="Unified GitHub Actions submission for v${{ inputs.version }}"
          HTTP_CODE=$(curl --silent --show-error \
            --output "$BODY" \
            --dump-header "$HEADERS" \
            --write-out '%{http_code}' \
            -H "Authorization: ApiKey $EDGE_API_KEY" \
            -H "X-ClientID: $EDGE_CLIENT_ID" \
            -H "Content-Type: text/plain" \
            -X POST \
            --data-binary "$NOTES" \
            "$EDGE_API_ROOT/products/$EDGE_PRODUCT_ID/submissions")
          cat "$BODY"
          if [[ "$HTTP_CODE" != "202" ]]; then
            echo "::error::Edge submission returned HTTP $HTTP_CODE"
            exit 1
          fi
          LOCATION=$(awk 'BEGIN{IGNORECASE=1} /^location:/ {gsub("\\r", "", $2); print $2}' "$HEADERS" | tail -n1)
          OPERATION_ID="${LOCATION##*/}"
          if [[ -z "$OPERATION_ID" ]]; then
            echo "::error::Edge submission did not return a Location operation ID"
            cat "$HEADERS"
            exit 1
          fi
          echo "operation_id=$OPERATION_ID" >> "$GITHUB_OUTPUT"

      - name: Wait for Edge submission creation
        shell: bash
        env:
          OPERATION_ID: ${{ steps.edge_submit.outputs.operation_id }}
        run: |
          set -euo pipefail
          for attempt in $(seq 1 60); do
            RESPONSE=$(curl --fail-with-body --silent --show-error \
              -H "Authorization: ApiKey $EDGE_API_KEY" \
              -H "X-ClientID: $EDGE_CLIENT_ID" \
              "$EDGE_API_ROOT/products/$EDGE_PRODUCT_ID/submissions/operations/$OPERATION_ID")
            STATUS=$(jq -r '.status // empty' <<< "$RESPONSE")
            echo "Submission creation [$attempt/60]: ${STATUS:-Unknown}"
            case "$STATUS" in
              Succeeded) echo "$RESPONSE" | jq .; exit 0 ;;
              Failed) echo "$RESPONSE" | jq .; exit 1 ;;
            esac
            sleep 10
          done
          echo "::error::Timed out waiting for Edge submission creation"
          exit 1
```

- [ ] **Step 5: Verify Edge no longer builds or owns a tag**

Run:

```bash
! grep -q "v\*-edge" .github/workflows/edge-store.yml
! grep -q "npm run build" .github/workflows/edge-store.yml
! grep -q "npm run test" .github/workflows/edge-store.yml
grep -q "actions/download-artifact@v5" .github/workflows/edge-store.yml
```

Expected: command exits 0.

- [ ] **Step 6: Commit reusable Edge publishing**

```bash
git add .github/workflows/edge-store.yml
git commit -m "ci: reuse unified package for edge store"
```

---

### Task 4: Add Chrome Web Store API v2 Publishing

**Files:**
- Create: `.github/workflows/chrome-store.yml`

**Interfaces:**
- Consumes inputs: `version`, `artifact_name`, `package_filename`
- Consumes secrets: `CHROME_SERVICE_ACCOUNT_JSON`, `CHROME_SERVICE_ACCOUNT_EMAIL`, `CHROME_PUBLISHER_ID`, `CHROME_EXTENSION_ID`
- OAuth scope: `https://www.googleapis.com/auth/chromewebstore`
- Upload endpoint: `POST https://chromewebstore.googleapis.com/upload/v2/publishers/{publisherId}/items/{extensionId}:upload`
- Status endpoint: `GET https://chromewebstore.googleapis.com/v2/publishers/{publisherId}/items/{extensionId}:fetchStatus`
- Publish endpoint: `POST https://chromewebstore.googleapis.com/v2/publishers/{publisherId}/items/{extensionId}:publish`

- [ ] **Step 1: Create the reusable Chrome workflow contract**

Create `.github/workflows/chrome-store.yml` with:

```yaml
name: Publish Chrome Web Store

on:
  workflow_call:
    inputs:
      version:
        required: true
        type: string
      artifact_name:
        required: true
        type: string
      package_filename:
        required: true
        type: string
    secrets:
      CHROME_SERVICE_ACCOUNT_JSON:
        required: true
      CHROME_SERVICE_ACCOUNT_EMAIL:
        required: true
      CHROME_PUBLISHER_ID:
        required: true
      CHROME_EXTENSION_ID:
        required: true

permissions:
  contents: read

jobs:
  publish:
    runs-on: ubuntu-latest
    env:
      PACKAGE: package/${{ inputs.package_filename }}
      PUBLISHER_ID: ${{ secrets.CHROME_PUBLISHER_ID }}
      EXTENSION_ID: ${{ secrets.CHROME_EXTENSION_ID }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Download unified package artifact
        uses: actions/download-artifact@v5
        with:
          name: ${{ inputs.artifact_name }}
          path: package

      - name: Validate Chrome inputs and package
        shell: bash
        env:
          SERVICE_ACCOUNT_JSON: ${{ secrets.CHROME_SERVICE_ACCOUNT_JSON }}
          SERVICE_ACCOUNT_EMAIL: ${{ secrets.CHROME_SERVICE_ACCOUNT_EMAIL }}
        run: |
          set -euo pipefail
          test -n "$SERVICE_ACCOUNT_JSON"
          test -n "$SERVICE_ACCOUNT_EMAIL"
          test -n "$PUBLISHER_ID"
          test -n "$EXTENSION_ID"
          test -f "$PACKAGE"
          PACKAGE_VERSION="$(unzip -p "$PACKAGE" manifest.json | jq -r '.version')"
          if [[ "$PACKAGE_VERSION" != "${{ inputs.version }}" ]]; then
            echo "::error::Chrome package version $PACKAGE_VERSION does not match ${{ inputs.version }}"
            exit 1
          fi

      - name: Authenticate to Google
        id: google_auth
        uses: google-github-actions/auth@v3
        with:
          credentials_json: ${{ secrets.CHROME_SERVICE_ACCOUNT_JSON }}
          service_account: ${{ secrets.CHROME_SERVICE_ACCOUNT_EMAIL }}
          token_format: access_token
          access_token_scopes: https://www.googleapis.com/auth/chromewebstore
```

- [ ] **Step 2: Upload and handle synchronous/asynchronous Chrome processing**

Append these steps:

```yaml
      - name: Upload package to Chrome Web Store
        id: chrome_upload
        shell: bash
        env:
          ACCESS_TOKEN: ${{ steps.google_auth.outputs.access_token }}
        run: |
          set -euo pipefail
          RESPONSE=$(curl --fail-with-body --silent --show-error \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -X POST \
            -T "$PACKAGE" \
            "https://chromewebstore.googleapis.com/upload/v2/publishers/$PUBLISHER_ID/items/$EXTENSION_ID:upload")
          echo "$RESPONSE" | jq .

          STATE=$(jq -r '.uploadState // empty' <<< "$RESPONSE")
          CRX_VERSION=$(jq -r '.crxVersion // empty' <<< "$RESPONSE")
          if [[ -n "$CRX_VERSION" && "$CRX_VERSION" != "${{ inputs.version }}" ]]; then
            echo "::error::Chrome reports uploaded version $CRX_VERSION, expected ${{ inputs.version }}"
            exit 1
          fi
          echo "upload_state=$STATE" >> "$GITHUB_OUTPUT"

      - name: Wait for asynchronous Chrome upload
        if: steps.chrome_upload.outputs.upload_state == 'IN_PROGRESS'
        shell: bash
        env:
          ACCESS_TOKEN: ${{ steps.google_auth.outputs.access_token }}
        run: |
          set -euo pipefail
          for attempt in $(seq 1 60); do
            RESPONSE=$(curl --fail-with-body --silent --show-error \
              -H "Authorization: Bearer $ACCESS_TOKEN" \
              "https://chromewebstore.googleapis.com/v2/publishers/$PUBLISHER_ID/items/$EXTENSION_ID:fetchStatus")
            STATE=$(jq -r '.lastAsyncUploadState // empty' <<< "$RESPONSE")
            echo "Chrome upload [$attempt/60]: ${STATE:-Unknown}"
            case "$STATE" in
              SUCCEEDED) echo "$RESPONSE" | jq .; exit 0 ;;
              FAILED|NOT_FOUND) echo "$RESPONSE" | jq .; exit 1 ;;
            esac
            sleep 5
          done
          echo "::error::Timed out waiting for Chrome package processing"
          exit 1

      - name: Reject failed immediate Chrome upload
        if: steps.chrome_upload.outputs.upload_state != 'SUCCEEDED' && steps.chrome_upload.outputs.upload_state != 'IN_PROGRESS'
        shell: bash
        run: |
          echo "::error::Unexpected Chrome upload state: ${{ steps.chrome_upload.outputs.upload_state }}"
          exit 1
```

- [ ] **Step 3: Submit the uploaded item for review and publishing**

Append:

```yaml
      - name: Submit Chrome item for review and publishing
        shell: bash
        env:
          ACCESS_TOKEN: ${{ steps.google_auth.outputs.access_token }}
        run: |
          set -euo pipefail
          RESPONSE=$(curl --fail-with-body --silent --show-error \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            -X POST \
            --data '{"publishType":"DEFAULT_PUBLISH","blockOnWarnings":true}' \
            "https://chromewebstore.googleapis.com/v2/publishers/$PUBLISHER_ID/items/$EXTENSION_ID:publish")
          echo "$RESPONSE" | jq .
          STATE=$(jq -r '.state // empty' <<< "$RESPONSE")
          case "$STATE" in
            PENDING_REVIEW|PUBLISHED) ;;
            *)
              echo "::error::Unexpected Chrome publish state: ${STATE:-empty}"
              exit 1
              ;;
          esac
```

- [ ] **Step 4: Verify only API v2 endpoints are used**

Run:

```bash
grep -n "chromewebstore.googleapis.com" .github/workflows/chrome-store.yml
! grep -q "v1\.1" .github/workflows/chrome-store.yml
```

Expected: upload/status/publish URLs all contain `/v2/`; command exits 0.

- [ ] **Step 5: Commit Chrome publishing**

```bash
git add .github/workflows/chrome-store.yml
git commit -m "ci: publish unified package to chrome web store"
```

---

### Task 5: Document Store Setup and Unified Distribution

**Files:**
- Modify: `docs/EDGE_STORE_PUBLISHING.md`
- Create: `docs/CHROME_STORE_PUBLISHING.md`
- Modify: `README.md`

**Interfaces:**
- Documents the one release command: `git tag vX.Y.Z && git push origin vX.Y.Z`
- Documents Edge secrets and Chrome secrets exactly as workflows consume them

- [ ] **Step 1: Rewrite Edge publishing docs for the unified tag**

Replace the old `-edge` tag instructions with:

```markdown
## Release trigger

Edge publishing is part of the unified Chromium release. There is no `-edge` tag.

For version `1.0.12`, `src/manifest.json` and `package.json` must both contain `1.0.12`, then push exactly one tag:

```bash
git tag v1.0.12
git push origin v1.0.12
```

The unified release builds one ZIP once. The Edge workflow downloads that exact package artifact and submits it to the existing Edge Add-ons product.
```

Keep the existing credential descriptions for `EDGE_CLIENT_ID`, `EDGE_API_KEY`, and `EDGE_PRODUCT_ID`.

- [ ] **Step 2: Add Chrome Web Store setup documentation**

Create `docs/CHROME_STORE_PUBLISHING.md` containing these required setup steps:

```markdown
# Chrome Web Store publishing

Chrome publishing is part of the unified `vX.Y.Z` release and uses Chrome Web Store API v2.

## One-time setup

1. Create the extension item in the Chrome Web Store Developer Dashboard.
2. Complete the Store listing and Privacy tabs and satisfy Google's 2-step-verification requirement.
3. Enable the Chrome Web Store API in a Google Cloud project.
4. Create a Google Cloud service account.
5. Add that service account email in the Chrome Web Store Developer Dashboard so it can manage the publisher's items.
6. Grant the service account `roles/iam.serviceAccountTokenCreator` on itself so `google-github-actions/auth@v3` can mint a scoped OAuth access token from the stored service-account JSON key.
7. Add these GitHub Actions secrets:
   - `CHROME_SERVICE_ACCOUNT_JSON` — minified service-account key JSON.
   - `CHROME_SERVICE_ACCOUNT_EMAIL` — the service account `client_email`.
   - `CHROME_PUBLISHER_ID` — Publisher ID from Chrome Web Store Developer Dashboard → Publisher → Settings.
   - `CHROME_EXTENSION_ID` — the existing Chrome Web Store item ID.

## Release

For version `1.0.12`:

```bash
git tag v1.0.12
git push origin v1.0.12
```

The release workflow uploads the same ZIP used by GitHub Releases and Microsoft Edge Add-ons, waits for asynchronous package processing when necessary, then calls the API v2 `publish` method with `DEFAULT_PUBLISH`.

Brave users install the same extension from the Chrome Web Store; no Brave-specific release exists.
```

- [ ] **Step 3: Update README positioning and installation paths**

Change the opening description from Chrome-only wording to:

```markdown
An intelligent, on-device Chromium extension for Google Chrome, Microsoft Edge, Brave, and compatible Chromium browsers.
```

Add a distribution section containing:

```markdown
## Install

- **Google Chrome / Brave:** install from the Chrome Web Store listing.
- **Microsoft Edge:** install from Microsoft Edge Add-ons.
- **Generic Chromium / development:** download the GitHub Release ZIP or build locally and load `dist/` as an unpacked extension.

All channels use the same extension version and the same release package. A single `vX.Y.Z` Git tag drives GitHub, Edge, and Chrome publishing.
```

- [ ] **Step 4: Confirm no docs instruct users to create `-edge` tags**

Run:

```bash
! grep -R --line-number -- "v.*-edge\|-edge.*tag" README.md docs/EDGE_STORE_PUBLISHING.md docs/CHROME_STORE_PUBLISHING.md
```

Expected: command exits 0.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md docs/EDGE_STORE_PUBLISHING.md docs/CHROME_STORE_PUBLISHING.md
git commit -m "docs: document unified chromium distribution"
```

---

### Task 6: Prepare and Verify the First Unified Release Version

**Files:**
- Modify: `src/manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces the release identity `1.0.12` / `v1.0.12`
- `npm run release:validate -- v1.0.12` must pass before the tag is created

- [ ] **Step 1: Bump all package metadata to `1.0.12`**

Set:

```json
// src/manifest.json
"version": "1.0.12"
```

Set:

```json
// package.json
"version": "1.0.12"
```

Run npm's metadata-only version update so `package-lock.json` root/package metadata is synchronized without creating a Git tag:

```bash
npm version 1.0.12 --no-git-tag-version --allow-same-version
```

- [ ] **Step 2: Verify the release contract locally**

Run:

```bash
npm run release:validate -- v1.0.12
```

Expected output includes:

```text
Release version: 1.0.12
Artifact: ai-vision-ad-blocker-v1.0.12.zip
```

- [ ] **Step 3: Run the complete pre-release verification**

Run:

```bash
npm ci
npm run test:coverage
npm run build
npm run test:e2e
```

Expected: all commands exit 0.

Then package exactly as CI does and inspect the manifest:

```bash
rm -rf release && mkdir release
(cd dist && zip -qr ../release/ai-vision-ad-blocker-v1.0.12.zip .)
zipinfo -1 release/ai-vision-ad-blocker-v1.0.12.zip | grep -Fx 'manifest.json'
unzip -p release/ai-vision-ad-blocker-v1.0.12.zip manifest.json | jq -e '.version == "1.0.12"'
```

Expected: both validation commands exit 0.

- [ ] **Step 4: Commit the version bump**

```bash
git add src/manifest.json package.json package-lock.json
git commit -m "chore: prepare unified release v1.0.12"
```

- [ ] **Step 5: Final workflow invariant checks before merging**

Run:

```bash
npm run release:validate -- v1.0.12

test "$(grep -R "npm run build" .github/workflows/release.yml .github/workflows/edge-store.yml .github/workflows/chrome-store.yml | wc -l)" -eq 1
! grep -R -q "v\*-edge" .github/workflows
! grep -R -q "chromewebstore/v1\.1" .github/workflows

grep -q "uses: ./.github/workflows/edge-store.yml" .github/workflows/release.yml
grep -q "uses: ./.github/workflows/chrome-store.yml" .github/workflows/release.yml
```

Expected: all commands exit 0.

Do **not** create/push `v1.0.12` until all four Chrome secrets are configured and the initial Chrome Web Store item/listing exists. Once those prerequisites are complete, the release command is only:

```bash
git tag v1.0.12
git push origin v1.0.12
```

That single tag must fan out to GitHub Release, Edge Add-ons, and Chrome Web Store using the one packaged ZIP.
