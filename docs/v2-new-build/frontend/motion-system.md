# Frontend Motion System

Status: current
Scope: documentation
Last updated: 2026-05-29
Source of truth: yes

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
