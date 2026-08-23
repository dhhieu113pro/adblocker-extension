# Microsoft Edge Store publishing

Microsoft Edge Add-ons updates are published automatically from GitHub Actions when a tag ends with `-edge`.

## Required GitHub Actions secrets

Create these repository secrets in **Settings → Secrets and variables → Actions**:

- `EDGE_CLIENT_ID` — Client ID from Partner Center → Microsoft Edge → Publish API.
- `EDGE_API_KEY` — API key from Partner Center → Microsoft Edge → Publish API.
- `EDGE_PRODUCT_ID` — Product ID / GUID of the existing Edge Add-ons listing.

The first Edge Add-ons product/listing must already exist in Partner Center. The API updates an existing product; it does not create the first listing.

## Tag format

The tag must end in `-edge` and its version must match `src/manifest.json`.

Example when the manifest version is `1.0.12`:

```bash
git tag v1.0.12-edge
git push origin v1.0.12-edge
```

A mismatched tag such as `v1.0.13-edge` while the manifest still says `1.0.12` fails before upload.

## Edge release pipeline

The `Publish Microsoft Edge Store` workflow performs:

1. `npm ci`
2. Unit tests with the 100% coverage gate
3. Extension build
4. Playwright Chromium installation
5. Real installed-extension E2E tests
6. Tag / manifest version validation
7. ZIP packaging of `dist/`
8. Upload to Microsoft Edge Add-ons
9. Poll package validation until `Succeeded` or `Failed`
10. Submit the validated draft for certification
11. Poll submission creation until `Succeeded` or `Failed`

A successful workflow means Microsoft accepted the update as a Store submission. Microsoft certification/review may continue after the workflow completes.

## Other release tags

Tags matching `v*` that do **not** end in `-edge` continue to use the normal GitHub release workflow.
