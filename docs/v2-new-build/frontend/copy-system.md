# Frontend Copy System

Status: accepted
Scope: documentation
Last updated: 2026-06-05
Source of truth: yes

Owns:
- copy system decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This document defines the current copy direction.

## Core rule

Landing should sell, onboarding should guide, and the app should stop explaining itself.

## Tone

- premium
- calm
- confident
- short
- clear

Avoid:

- internal build language
- long instructional paragraphs in the app shell
- crypto-jargon overload
- repeated reassurance chips

## Landing copy

Use:

- watch without the noise
- direct creator value
- calm discovery
- safe intentional space

Avoid:

- product-spec wording
- route or implementation language
- “MVP”
- “shell”

## Onboarding copy

Use:

- `Passkey is the easiest start.`
- `WEVID is a safe space.`
- `Recommended for full functionality.`
- `Skip for now.`

Rules:

- explain why a step exists in one line
- explain time cost briefly
- privacy explanation lives inside Login and Wallet

## App shell copy

Rules:

- no hero-style explanatory paragraphs
- no status chips repeating the same state
- labels should support the next action only

Product-facing naming:

- say `Bit` for a native short video
- say `Clip` for a longer video
- say `Moment` for the product-facing story format
- say `Mirror` for the product-facing share action
- say `Support` instead of tip
- say `Unlock` for paid content access in UI, while contracts may still use `content_unlock`
- say `Creator Membership`, `Member access`, and `Membership tier`
- say `Event Access`, `Pass`, `Passes`, `Get Access`, and `Reserve Access`
- say `Mutuals`, `Show Interest`, `Interested`, `Mutual`, `Mutual chat`, and `Mutuals mode`
- say `Use WEVID wallet`, `Connect my wallet`, and `Pay from wallet`
- say `Free Verified`, `WEVID Plus`, `WEVID Studio`, and `Enterprise`
- keep `video` as the generic fallback when the duration bucket is not the point of the UI

Avoid:

- `tip` in user-facing UI
- `ticket` for launch-facing Event Access UI
- `dating`, `swipe`, `match`, or `match chat` for launch-facing Mutuals UI
- `creator subscription` for launch-facing Creator Membership UI
- `Max`, `Power`, or other platform tier names outside the approved tier list
- any copy implying money buys people, ranking boosts, Mutuals priority, or message priority

Allowed:

- short content titles
- short empty states
- compact sheet labels
- activity-first message labels grounded in real backend events

## Profile semantics in copy

- say `Profile` for the user’s own managed area
- say `Creator` for contextual viewer-facing routes
- do not describe creator routes as a second profile concept
