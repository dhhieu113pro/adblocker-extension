# Privacy Policy — AI Vision Ad Blocker

Last updated: 2026-08-16

AI Vision Ad Blocker is designed to block advertisements while keeping analysis on the user's device.

## Data collection

The extension does not collect, sell, or transmit personal information, browsing history, page content, images, or visited URLs to the developer.

## Local browser storage

The extension stores the following data locally in the browser:

- Auto-hide and selected vision-model settings.
- Classification results cached by image URL.
- A local history of blocked advertising URLs and page URLs.
- Cached ad-blocking rules downloaded from this repository.

This information is not sent to the developer or shared with third parties.

## Local AI processing

Image and page classification runs locally in the browser using the packaged inference runtime and downloaded model data. Images are not uploaded to a developer-operated server.

## Remote resources

The extension may download model data from Hugging Face and JSON ad-blocking rules from this GitHub repository. The rules are cached locally and are used only to improve advertising detection.

## Permissions

The extension requests browser permissions only to inspect pages for advertising, block advertising requests and redirects, run local inference, store local settings and results, and provide the user-invoked image-analysis context-menu action.

## Changes

This policy may be updated when the extension's data practices change. The latest version will be published in this repository.

## Contact

For privacy questions or requests, open an issue at:

https://github.com/dhhieu113pro/adblocker-extension/issues
