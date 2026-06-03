# Frontend Motion System

Status: accepted
Scope: documentation
Last updated: 2026-06-03
Source of truth: yes

Owns:
- motion system decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This file defines the current motion language.

## Principles

- fast
- premium
- restrained
- media-first

## Current motion use

- desktop landing moves horizontally between panels
- shell content swaps inside a persistent frame
- rail expansion, active nav, and segmented controls shift through color and background
- sheets reveal quickly without bounce

## Timing

- micro feedback: `120ms - 160ms`
- control changes: `160ms - 220ms`
- surface enter: `220ms - 320ms`

## Guardrails

- no motion that delays feed interaction
- no animated blur walls
- no toy-like spring behavior in core navigation
