# Veel V2 Native UI, Screens, Gestures, And Motion

Status: accepted
Scope: desktop/mobile PWA UX
Last updated: 2026-06-12
Source of truth: yes

Owns:
- native ui ux screens decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This document defines how every main v2 screen should behave so Veel feels like a native desktop/mobile social video app rather than a stretched web dashboard.

## UX Principles

- Media first, actions second, text third, metadata last.
- Desktop and mobile adapt; they do not simply scale.
- The primary app should feel like an installed native app, not a scrolling web page.
- Main media surfaces are viewport-locked: one focused screen, no document-level scroll, next media by swipe, click, keyboard, or visible controls.
- Internal panels/sheets may scroll, but the root app viewport must stay stable.
- One gesture has one meaning inside one visual mode.
- Every gesture has a visible accessible control.
- Money, publishing, Event Access, Mutuals, reporting, and moderation require explicit controls.
- PWA should feel installable, fast, resilient, and safe.

## App Shell

Mobile bottom nav:

```text
Home | Bits | Create | Messages | Profile
```

Mobile top actions:

```text
Messages | Notifications | Wallet/account
```

Desktop left rail:

```text
Home
Bits
Discover
Create
Messages
Profile
```

Desktop secondary:

```text
Event Access
Mutuals
Wallet
Settings
```

Rules:

- Admin is separate protected surface.
- Mutuals is explicit mode, not root nav.
- Events are content type + Event Access conversion flow.
- Discover, Event Access, Mutuals, Wallet, Settings, and Assistant live in
  secondary menus, contextual surfaces, or route-specific affordances on mobile.
- AI/MCP is not root nav or a primary mobile dock item.
- Activity lives under Profile/Settings/Wallet.

Mockup-derived shell direction:

- desktop uses a quiet fixed rail and keeps media/content in the center
- mobile uses a compact dock plus top account/wallet/status affordances
- glass and blur are used sparingly for chrome and sheets, not as nested cards
- no inert navigation, fake tools, or buttons without a real route/action

## Home And Bits Product Meaning

Home is the mixed social feed:

- top rail: live, moments, and live replays
- below: media grid/feed with Bits, clips, images, VOD teasers, premium teasers, followed creators, and recommendations
- desktop: adaptive 3-column or centered grid depending viewport
- mobile: one media card per row

Bits is the reels-like short-video feed:

- vertical swipe between Bits
- video-first, full-screen on mobile
- free by default for discoverability
- if a long clip/VOD exists, its selected teaser segment can appear as a Bit

Terminology:

- Bit: video up to roughly 60 seconds, always free/discoverable
- Clip: longer video; can include a free Bit/teaser segment
- VOD/live replay: long-form media; may be free, teaser-only, subscriber, pass, or content-unlock-gated

This prevents the platform from becoming too locked and keeps discovery healthy.

## Screen Inventory

| Screen | Mobile behavior | Desktop behavior |
| --- | --- | --- |
| Home | One-column feed, moment/live rail, top actions, bottom nav | 3-column or centered feed, left rail, optional right suggestions |
| Bits | Full-screen vertical feed | Center 9:16 player, fixed action/comment/profile panels |
| Discover | Search-first, chips/tabs, one-column results | Search with filters and media/person/event columns |
| Create | Full-screen native capture/upload flow | Studio workspace/panel |
| Messages | Inbox screen, thread full-screen | List + thread workspace, quick chat desktop-only |
| Profile | Instagram-like profile/tabs/grid | Wider grid, creator/action panel |
| Media viewer | Full-screen Reels/TikTok style, no root scroll | Viewport-locked stage + action rail + side panels |
| Live room | Stage first, pass/chat sheets | Large stage, chat/access panels secondary |
| Moment viewer | Tap progression | Story/moment modal with keyboard support |
| Activity | List-based categories | Filtered activity table/list |
| Wallet | Wallet state, transactions, receipts | Wider transaction/activity workspace |
| Settings | Native settings groups | Two-pane settings |

## Home Screen

Mobile:

- one media card per row
- no horizontal overflow
- activity rail scrolls horizontally
- bottom nav never covers card actions
- top actions stay compact

Desktop:

- left rail fixed and quiet
- moments/live/replay rail near top
- media cards 3-column where viewport allows
- hover preview muted
- quick chat does not cover media actions

Actions:

- tapping media opens media viewer
- follow/like/save happen in place
- comment/share/more open sheet/popover
- support/unlock open same-screen payment sheet

## Media Viewer

Desktop:

- viewport-locked
- no document-level scroll
- centered media stage
- right action rail fixed
- comments/share/details side panels scroll internally
- share panel separates internal Veel send/repost from external referral-capable links
- creator metadata stays inside viewport
- keyboard next/previous and Esc supported

Mobile:

- full-screen viewer
- right action rail overlays media
- metadata bottom-left
- comments/share/details/payment as bottom sheets
- share sheet has actions for Copy link, internal Veel send/repost, WhatsApp, Telegram, Instagram, TikTok, X, LinkedIn, and system share where available
- external share links include referral attribution when policy allows; internal Veel send/repost does not create referral commission by default
- swipe up/down next/previous
- click/tap the next affordance advances to the next media item when swipe is unavailable
- haptic/vibration feedback is used where browser/device support exists and user settings allow it
- no desktop quick chat dock
- bottom nav hidden or safely integrated depending mode

## Live Room

Mobile:

- video/live stage first
- one mode-specific access CTA, compact
- paid event details or profile-membership conversion in one bottom sheet
- chat as sheet/panel
- creator metadata compact
- no overlapping text

Desktop:

- large live/replay stage
- status visible: Waiting, Live, Replay, Locked
- access pass panel secondary
- chat panel clean
- technical details collapsed

## Create

Mobile:

- record/upload first
- bottom-aligned or sheet-based steps: media, thumbnail/teaser, caption, labels,
  monetise, optional event, preview, publish
- thumbnail and Bit/teaser selection are simple native controls
- labels include SFW/adult/explicit, independent content warnings, and optional event attachment only
- event attachment captures date/time, pass capacity, public sale or private request-to-join, digital live stream or physical location, and map-assisted location search
- Mutuals is not configured in Create; it is enabled from profile/settings and appears as a Mutuals-active affordance on eligible creator media
- record/publish explicit
- global gestures disabled
- safe-area aware

Desktop:

- clean studio workspace
- media preview dominant
- steps/panels around preview
- status/readiness remains compact and operational
- no complex timeline editor in MVP

MVP non-goals:

- stickers
- GIF overlays
- music catalogue
- AI media editing
- beauty filters
- advanced timeline editing

## Profile

Own profile:

- avatar/header/stats
- edit profile/dashboard/activity
- tabs: Feed, Bits, Premium, Collabs
- live replay/memories row above grid
- readiness, wallet, age/KYC, and monetisation state use backend projections and
  route to real remediation surfaces

Public profile:

- Follow, Message, Support, Membership/Unlock where applicable
- creator media grid
- premium/live/event states
- Assistant is not a public profile CTA; creator-side assistant/MCP setup belongs
  under Studio/Profile settings when capability allows

## Messages

Mobile:

- no floating desktop dock
- dedicated Messages screen
- thread full-screen
- sheets for share/send flows

Desktop:

- quick chat dock only on desktop
- compact readable thread windows
- full inbox route with list/thread workspace
- no overlay stacking over itself

## Gesture Ownership

| Mode | Vertical gesture | Horizontal gesture | Back/close |
| --- | --- | --- | --- |
| App shell | Scroll page/feed | Avoid root switching unless safe | Browser/OS back or visible back |
| Home | Feed scroll | None by default | Bottom nav/back |
| Bits/media | Next/previous media | Creator panel/create action in normal mode | Esc/back/X |
| Mutuals mode | Next/previous media | Show Interest / Not interested | Exit mode/back |
| Event Access mode | Next/previous media | Interested / Get Access / Not interested | Exit/back |
| Profile | Scroll profile | Profile tabs only | Back/nav |
| Moment viewer | Tap/limited vertical | Previous/next story group | X/back/swipe-down where safe |
| Create/editor | Editing gestures only | Editing gestures only | Cancel/save/back |
| Checkout/payment | Scroll form | No horizontal gestures | Explicit close/back |

Do not start custom horizontal gestures from the extreme screen edge. OS/browser edge-back owns that area.

## Native PWA Rules

- Mobile must feel like a native app, not a desktop page squeezed down.
- Desktop must feel like a desktop-native media app, not a mobile clone.
- Media viewer is full-screen/viewport-locked.
- Bottom sheets on mobile; side panels or compact modals on desktop.
- Wallet linking/signing should stay same-screen where provider allows it.
- No unnecessary redirects for payment, unlock, support, Event Access, or Mutuals actions.
- Gestures are shortcuts only; buttons remain visible.

## Motion Rules

- 140-180ms for small UI transitions.
- 220-320ms for sheet/viewer transitions.
- UI follows finger during drag.
- Use velocity-aware settle after release.
- Avoid scroll-jacking in core app.
- Respect `prefers-reduced-motion`.
- Disable heavy blur stacks during mobile scroll.
- Do not animate payment confirmation in a way that hides wallet/backend state.

## Accessibility

- touch targets 44-56px for primary controls
- visible focus rings
- keyboard navigation on desktop
- Esc closes topmost overlay
- sheets trap focus where appropriate
- gestures have visible buttons
- no color-only status communication
- no text clipped inside buttons/cards

## Screen Tests

Required:

- Home mobile one-card-per-row
- Home desktop 3-column/rail
- media viewer desktop viewport-locked
- media viewer mobile full-screen
- live room mobile no overlap
- messages mobile no desktop dock
- sourceContext active nav
- reduced motion smoke
- no horizontal overflow
