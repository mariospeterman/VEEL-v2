# Veel V2 Native UI, Screens, Gestures, And Motion

Status: proposed v2 architecture
Scope: desktop/mobile PWA UX
Last updated: 2026-06-03
Source of truth: proposal

This document defines how every main v2 screen should behave so Veel feels like a native desktop/mobile social video app rather than a stretched web dashboard.

## UX Principles

- Media first, actions second, text third, metadata last.
- Desktop and mobile adapt; they do not simply scale.
- One gesture has one meaning inside one visual mode.
- Every gesture has a visible accessible control.
- Money, publishing, tickets, matching, reporting, and moderation require explicit controls.
- PWA should feel installable, fast, resilient, and safe.

## App Shell

Mobile bottom nav:

```text
Home | Bits | Create | Discover | Profile
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
Events
Dating
Wallet
Settings
```

Rules:

- Admin is separate protected surface.
- Dating is explicit mode, not root nav.
- Events are content type + conversion flow.
- AI/MCP is not root nav.
- Activity lives under Profile/Settings/Wallet.

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
- VOD/live replay: long-form media; may be free, teaser-only, subscriber, pass, or unlock-gated

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
| Media viewer | Full-screen Reels/TikTok style | Viewport-locked stage + action rail + side panels |
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
- tip/support/unlock open same-screen payment sheet

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
- no desktop quick chat dock
- bottom nav hidden or safely integrated depending mode

## Live Room

Mobile:

- video/live stage first
- pass CTA compact
- pass options in bottom sheet
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
- bottom-aligned steps: media, edit, caption, labels, monetise, preview, publish
- thumbnail and Bit/teaser selection are simple native controls
- text/GIF overlays are lightweight, not a complex timeline editor
- music is only from licensed/provider-cleared catalog or creator-owned audio
- labels include NSFW/adult/sensitive and optional event attachment only
- event attachment captures date/time, ticket amount/capacity, public sale or private request-to-join, online/physical location, and map-assisted location search
- Dating Mode is not configured in Create; it is enabled from profile/settings and appears as a dating-active affordance on eligible creator media
- record/publish explicit
- global gestures disabled
- safe-area aware

Desktop:

- clean studio workspace
- media preview dominant
- steps/panels around preview
- no complex timeline editor in MVP

## Profile

Own profile:

- avatar/header/stats
- edit profile/dashboard/activity
- tabs: Feed, Bits, Premium, Collabs
- live replay/memories row above grid

Public profile:

- Follow, Message, Support, Subscribe/Unlock where applicable
- creator media grid
- premium/live/event states

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
| Dating mode | Next/previous media | Yes / Not interested | Exit mode/back |
| Event mode | Next/previous media | Interested/ticket / not interested | Exit/back |
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
- No unnecessary redirects for payment, unlock, tip, support, ticket, or dating actions.
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
