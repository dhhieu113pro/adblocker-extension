# Microsoft Edge Store publishing

Microsoft Edge Add-ons publishing is part of the unified Chromium release. A single `vX.Y.Z` tag builds one tested ZIP and reuses that same package for GitHub Releases, Microsoft Edge Add-ons, and the Chrome Web Store.

## Required GitHub Actions secrets

Create these repository secrets in **Settings → Secrets and variables → Actions**:

- `EDGE_CLIENT_ID` — Client ID from Partner Center → Microsoft Edge → Publish API.
- `EDGE_API_KEY` — API key from Partner Center → Microsoft Edge → Publish API.
- `EDGE_PRODUCT_ID` — Product ID / GUID of the existing Edge Add-ons listing.

The first Edge Add-ons product/listing must already exist in Partner Center. The API updates an existing product; it does not create the first listing.

## Release trigger

Edge publishing is part of the unified Chromium release. There is no `-edge` tag.

For version `1.0.12`, `src/manifest.json` and `package.json` must both contain `1.0.12`, then push exactly one tag:

```bash
git tag v1.0.12
git push origin v1.0.12
```

The unified release builds one ZIP once. The Edge workflow downloads that exact package artifact and submits it to the existing Edge Add-ons product.

## Edge release pipeline

The reusable `Publish Microsoft Edge Store` workflow performs only store-specific work:

1. Download the unified release ZIP created by `release.yml`.
2. Validate the downloaded package exists and its manifest version matches the release version.
3. Validate `EDGE_CLIENT_ID`, `EDGE_API_KEY`, and `EDGE_PRODUCT_ID`.
4. Upload the package to Microsoft Edge Add-ons.
5. Poll package validation until `Succeeded` or `Failed`.
6. Submit the validated draft for certification.
7. Poll submission creation until `Succeeded` or `Failed`.

Tests, Playwright, the production build, and ZIP packaging happen once in the unified release build job before any store-specific publishing begins.

A successful Edge job means Microsoft accepted the update as a Store submission. Microsoft certification/review may continue after the workflow completes.
