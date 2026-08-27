# Chrome Web Store publishing

Chrome Web Store submission is currently manual. The unified Chromium ZIP produced by a `vX.Y.Z` release is attached to the GitHub Release and the same package is submitted automatically to Microsoft Edge Add-ons; upload that ZIP manually in the Chrome Web Store Developer Dashboard.

## Store permission declarations

The install-time permission model intentionally keeps broad website access optional while retaining baseline declarative network blocking.

- **Required host permission:** `https://raw.githubusercontent.com/*` is used only to download JSON ad-filter rule data.
- **Optional site access:** `http://*/*` and `https://*/*` are requested only after the user explicitly chooses **Enable full protection**. The granted access enables automatic page-level ad detection/hiding, popup/redirect handling that depends on page access, and local AI analysis on websites.
- **Remote code:** select **No**. Executable JavaScript and ONNX Runtime WASM are packaged with the extension. Remote model weights and JSON filter rules are data, not remotely executed code.

Optional broad HTTP/HTTPS access can still receive manual Chrome Web Store review. This design reduces the breadth of permissions required at install time; it does not guarantee that review will be skipped.

When writing the Chrome Web Store host-permission justification, describe the required and optional access separately so reviewers can see that full website access is user-initiated rather than granted automatically at install time.

## Release

For version `1.0.12`:

```bash
git tag v1.0.12
git push origin v1.0.12
```

The release workflow builds and validates one Chromium ZIP, attaches it to the GitHub Release, and submits that same ZIP to Microsoft Edge Add-ons. After the release succeeds, download `ai-vision-ad-blocker-v1.0.12.zip` from the GitHub Release and upload it to the existing Chrome Web Store item.

Brave users can install the same extension from the Chrome Web Store; no Brave-specific package exists.

## Optional future Chrome Web Store API automation

If automatic Chrome publication is re-enabled later, use Chrome Web Store API v2 rather than the deprecated v1 API. The initial store item must still be created in the Developer Dashboard before API publishing can manage it.

The required OAuth scope is:

```text
https://www.googleapis.com/auth/chromewebstore
```

Chrome Web Store API v2 endpoints use `chromewebstore.googleapis.com` for upload, status, and publish operations.
