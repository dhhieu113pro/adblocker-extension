# Streaming-Only Navigation Blocking

## Scope

Navigation blocking applies only when the current page is classified as Movie
Streaming, Comic/Manga, or another existing ad-prone streaming category.
Normal sites must keep ordinary links and popup navigation working.

## Changes

- Gate main-world click and `window.open` navigation checks in `src/inject.ts`
  behind the existing streaming-site classification.
- Remove the non-streaming popup-blocking branch in `src/background.ts`.
- Keep visual ad hiding and site-category detection unchanged.

## Validation

Rebuild the extension and confirm the generated bundle contains the streaming
gate while preserving the existing ad-blocking behavior on streaming sites.
