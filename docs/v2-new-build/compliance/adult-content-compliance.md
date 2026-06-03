# Adult Content Compliance

Status: accepted
Scope: documentation
Last updated: 2026-06-03
Source of truth: yes

Owns:
- adult content compliance decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

## Core rule

Provider choice does not remove platform obligations. The Fastify API remains the policy layer for legality, consent, age checks, monetization restrictions, moderation, takedowns, and playback authorization.

## Minimum launch requirements

- legal adult content only
- explicit consent only
- no non-consensual, exploitative, or illegal material
- creator verification and age-verification workflows must exist for upload/publish paths
- viewer age assurance must exist before protected-app and playback access
- report and takedown flows must remain operator-visible and auditable

## Recordkeeping and review

- maintain creator verification flags
- maintain moderation status and removal state
- maintain audit events for upload, publish, playback authorization, report, moderation action, and entitlement grant
- keep performer-consent and recordkeeping requirements under legal review before launch

## Jurisdiction notes

- US 2257-style obligations may apply depending on platform role and workflow
- UK/EU age assurance and online-safety obligations may apply
- geoblocking and audience restrictions are product policy tools, not legal substitutes
- legal review is required before launch

## Provider and host rules

- confirm Bunny and Livepeer terms in writing before launch for the exact adult-content use case
- confirm live-streaming terms separately if live explicit content is enabled
- NovoServe permits legal adult content on dedicated servers, but responsibility remains with the customer

## What this repo intentionally does not claim

- that provider DRM makes theft impossible
- that provider moderation replaces platform moderation
- that using external video providers removes the need for internal consent, takedown, or audit systems
