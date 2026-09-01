# Hybrid Ad Detection Design

## Goal

Combine deterministic ad-blocking signals with the extension's AI capability so obvious ads are blocked cheaply, obvious normal content is left alone, and only ambiguous candidates require model inference.

## Architecture

The decision pipeline is ordered by confidence and cost:

1. Existing network/filter-list rules block known advertising requests.
2. Site-specific and generic DOM evidence identifies explicit ad containers, sponsored labels, and ad overlays.
3. An evidence engine classifies candidates as `ad`, `normal`, or `ambiguous` without treating arbitrary URL substrings or IAB-like dimensions as sufficient proof.
4. Ambiguous candidates go to a fast visual AI model.
5. Uncertain visual results can be escalated to a second context-aware model using page URL, image host, destination URL, DOM/ad markers, network evidence, and the first model result.
6. Automatic hiding requires strong deterministic evidence or high AI confidence. Uncertain results remain visible.

## Evidence rules

Strong ad evidence includes known ad-network matches, explicit sponsored/advertisement semantics, site-specific ad containers, and explicit ad overlay/close controls.

Normal/trusted evidence includes ordinary content images, trusted media/CDN hosts, and page elements without explicit ad context. Image dimensions alone never make an image an ad. Short or generic URL substrings such as `qc`, `ads`, or `game` inside arbitrary paths, query strings, signed tokens, or IDs never make an image an ad.

## Two-model collaboration

Model A is the fast visual classifier. It is invoked only for ambiguous candidates and returns ad probability/confidence.

Model B is the context reviewer. It is invoked only when Model A is inconclusive. It receives structured context rather than relying on pixels alone: page host, image host, link host, sponsored/DOM signals, network/filter evidence, dimensions, and Model A's result.

The first implementation should use the existing model infrastructure where possible. If only one actual model endpoint is currently available, Model B is represented as a distinct context-review stage using that model with richer inputs; adding a second physical model is not required to land the safer pipeline.

## Decision policy

- Strong deterministic ad evidence: block/hide without AI.
- Strong normal/trusted evidence and no explicit ad evidence: allow without AI.
- Ambiguous: run Model A.
- High-confidence Model A ad: block/hide.
- Low-confidence Model A normal: allow.
- Middle confidence: run Model B.
- High-confidence Model B ad: block/hide.
- Any remaining uncertainty: allow and keep visible.

Automatic AI hiding must use a conservative threshold rather than the current 50% threshold. The implementation will encode named thresholds and cover their boundaries with tests.

## Regression requirements

Tests must cover normal YouTube thumbnails, signed CDN URLs containing misleading `qc`/`ads` text, ordinary editorial images with IAB-like dimensions, known ad-network URLs, sponsored elements, explicit ad containers/overlays, first-model high/low confidence, second-stage escalation, and uncertain results remaining visible.

## Scope

This change reuses the existing network blocking and AI infrastructure. It does not attempt to reproduce the full uBlock Origin filter language. Site-specific cosmetic-rule expansion and downloadable filter-list compatibility can be separate follow-up work.
