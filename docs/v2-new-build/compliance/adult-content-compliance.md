# Adult Content Compliance

Status: accepted
Scope: documentation
Last updated: 2026-08-11
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
- age-ready users may publish lawful SFW media without creator KYC
- adult/explicit publishing requires separate adult-publisher eligibility and media-specific performer/consent readiness
- creator KYC applies when creator proceeds are enabled; it does not grant adult publishing
- KYB applies only when a legal entity is the contracting or earning party and never grants Studio or Enterprise by itself
- viewer age assurance must exist before protected-app and playback access
- provider webhook results must be signature-verified server-side before any protected-app access state changes
- report and takedown flows must remain operator-visible and auditable

## Recordkeeping and review

- maintain creator verification flags
- maintain moderation status and removal state
- maintain audit events for upload, publish, playback authorization, report, moderation action, and entitlement grant
- maintain provider webhook receipt/event records for age-assurance decisions while avoiding raw identity payload storage
- block adult/explicit release until every depicted real person has the applicable identity, age, consent, and rights records; legal review remains a launch gate

## Contextual verification UX

Ordinary onboarding asks only for age assurance. A user who already intends to publish adult content may opt into one stronger identity-and-age flow during onboarding; this is never preselected or required for viewer/SFW access. The same adult-publisher flow appears contextually when adult or explicit is selected in Create. The API records versioned Adult Publisher Terms acceptance before the provider session and derives ordinary age access only from an approved high-assurance documentary result.

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
