# Hybrid Ad Detection Design

## Goal

Combine deterministic ad-blocking signals with the extension's AI capability so obvious ads are blocked cheaply, obvious normal content is left alone, and only ambiguous candidates require model inference.

## Architecture

The decision pipeline is ordered by confidence and cost:

1. Existing network/filter-list rules block known advertising requests.
2. Site-specific and generic DOM evidence identifies explicit ad containers, sponsored labels, and ad overlays.
3. An evidence engine classifies candidates as `ad`, `normal`, or `ambiguous` without treating arbitrary URL substrings or IAB-like dimensions as sufficient proof.
4. Ambiguous candidates go to the selected visual AI model.
5. Middle-confidence ad results are reviewed by the alternate local image classifier; the second result can promote blocking only when it reaches the conservative block threshold.
6. Automatic hiding requires strong deterministic evidence or high AI confidence. Uncertain results remain visible.

## Evidence rules

Strong ad evidence includes known ad-network matches, explicit sponsored/advertisement semantics, site-specific ad containers, and explicit ad overlay/close controls.

Normal/trusted evidence includes ordinary content images, trusted media/CDN hosts, and page elements without explicit ad context. Image dimensions alone never make an image an ad. Short or generic URL substrings such as `qc`, `ads`, or `game` inside arbitrary paths, query strings, signed tokens, or IDs never make an image an ad.

## Two-model collaboration

Model A is the selected local image classifier. With the default configuration this is CLIP; the existing RVL-CDIP classifier remains available through the legacy `mobilenet` preference key.

Model B is the alternate local image classifier. It is invoked only when Model A reports ad evidence in the review band. Model B reviews the same image independently; it does not consume arbitrary page text or DOM content. A secondary result can promote blocking only when its ad score reaches the conservative block threshold. Otherwise the primary result is retained and uncertain content remains visible.

A richer context-aware reviewer that consumes structured page/link/DOM evidence is a possible follow-up, but it is intentionally not part of this implementation.

## Decision policy

- Strong deterministic ad evidence: block/hide without AI.
- Strong normal/trusted evidence and no explicit ad evidence: allow without AI.
- Ambiguous: run Model A.
- High-confidence Model A ad: block/hide.
- Low-confidence Model A normal: allow.
- Middle-confidence ad evidence: run Model B.
- High-confidence Model B ad: block/hide.
- Any remaining uncertainty: allow and keep visible.

Automatic AI hiding uses named conservative thresholds: allow through 30%, review 31–84%, and block at 85% or higher.

## Regression requirements

Tests cover normal YouTube thumbnails, signed CDN URLs containing misleading `qc`/`ads` text, ordinary editorial images with IAB-like dimensions, known ad-network URLs, sponsored elements, explicit ad containers/overlays, first-model high/low confidence, second-stage escalation, and uncertain results remaining visible.

## Scope

This change reuses the existing network blocking and AI infrastructure. It does not attempt to reproduce the full uBlock Origin filter language. Site-specific cosmetic-rule expansion, downloadable filter-list compatibility, and structured context-aware model review can be separate follow-up work.
