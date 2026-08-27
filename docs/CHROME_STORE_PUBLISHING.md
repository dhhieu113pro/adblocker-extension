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

Chrome Web Store API v2 cannot create the initial store item, so the Developer Dashboard setup must be completed before the first automated release.

## Store permission declarations

The install-time permission model intentionally keeps broad website access optional while retaining baseline declarative network blocking.

- **Required host permission:** `https://raw.githubusercontent.com/*` is used only to download JSON ad-filter rule data.
- **Optional site access:** `http://*/*` and `https://*/*` are requested only after the user explicitly chooses **Enable full protection**. The granted access enables automatic page-level ad detection/hiding, popup/redirect handling that depends on page access, and local AI analysis on websites.
- **Remote code:** select **No**. Executable JavaScript and ONNX Runtime WASM are packaged with the extension. Remote model weights and JSON filter rules are data, not remotely executed code.

Optional broad HTTP/HTTPS access can still receive manual Chrome Web Store review. This design reduces the breadth of permissions required at install time; it does not guarantee that review will be skipped.

When writing the Chrome Web Store host-permission justification, describe the required and optional access separately so reviewers can see that full website access is user-initiated rather than granted automatically at install time.

## Release

For version `0.1.14`:

```bash
git tag v0.1.14
git push origin v0.1.14
```

The release workflow uploads the same ZIP used by GitHub Releases and Microsoft Edge Add-ons, waits for asynchronous package processing when necessary, then calls the API v2 `publish` method with `DEFAULT_PUBLISH`.

Brave users install the same extension from the Chrome Web Store; no Brave-specific release exists.

## Required OAuth scope

The workflow requests only the Chrome Web Store publishing scope:

```text
https://www.googleapis.com/auth/chromewebstore
```

## API endpoints

The workflow uses Chrome Web Store API v2 only:

- Upload: `POST https://chromewebstore.googleapis.com/upload/v2/publishers/{publisherId}/items/{extensionId}:upload`
- Status: `GET https://chromewebstore.googleapis.com/v2/publishers/{publisherId}/items/{extensionId}:fetchStatus`
- Publish: `POST https://chromewebstore.googleapis.com/v2/publishers/{publisherId}/items/{extensionId}:publish`

Do not configure the deprecated v1 API for this repository.
