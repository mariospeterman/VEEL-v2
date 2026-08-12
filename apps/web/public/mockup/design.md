# WeVid Design Contract — Codex 5.5

Use this file as the UI/UX implementation contract for the WeVid PWA frontend. Build a premium creator-first media app: simple, fast, one-screen where possible, native-feeling on mobile and desktop, and never like a backend dashboard.

## 1. Product north star

WeVid is a media-first creator platform. The UI must make the next action obvious within one screen: watch, create, message, unlock/support, or manage profile. Media is primary (so keep media on desktop near full screen, on mobile full screen when open), actions are secondary, metadata is tertiary. Every screen should feel calm, trusted, premium, and immediately understandable.

Avoid: crypto-casino visuals, dense admin-style navigation, excessive redirects, hidden money actions, gesture-only critical actions, and duplicated nav.

## 2. Route and navigation source of truth

Centralize all navigation in one `AppShell/NavConfig`. Do not duplicate nav per route.

```txt
Public:
/                 Landing
/                Landing story, login, and onboarding start
/age              Age verification handoff
/auth/confirm     Auth callback

Protected app shell:
/app/home
/app/bits
/app/create
/app/messages
/app/profile

Contextual routes / overlays:
/app/search
/app/media/:id
/app/live/:id
/app/event/:id
/app/wallet
/app/subscriptions
/app/settings
/app/studio
/app/enterprise
/app/assistant

Admin:
/admin            Separate protected shell, never normal user nav
```

### Mobile bottom nav
Exactly five items:

```txt
Home | Bits | Create | Messages | Profile
```

### Desktop left rail
Exactly the same five primary destinations:

```txt
Home
Bits
Create
Messages
Profile
```

### Top actions / menu
Search, notifications, wallet quick access, settings, subscriptions, Studio, Enterprise, Assistant, Help, and privacy tools live in top icons, profile hub, menus, sheets, or contextual screens. Do not expose everything as primary navigation.

## 3. Visual system

### Color tokens

```css
:root {
  --bg-dark: #050608;
  --bg-graphite: #0B0D12;
  --surface-dark: #111520;
  --surface-glass: rgba(255,255,255,0.07);
  --border-soft: rgba(255,255,255,0.12);

  --bg-light: #F7F8FB;
  --surface-light: #FFFFFF;
  --border-light: #E6E9F0;

  --text-primary-dark: #FFFFFF;
  --text-secondary-dark: #D9DEE8;
  --text-muted-dark: #8B94A7;

  --text-primary-light: #080A0F;
  --text-secondary-light: #3F4654;
  --text-muted-light: #7C8494;

  --brand-purple: #9945FF;
  --brand-green: #14F195;
  --brand-cyan: #03E1FF;

  --success: #22C55E;
  --warning: #F59E0B;
  --danger: #F43F5E;
}
```

Usage ratio: 85–90% neutral black/graphite/white, 5–8% glass and borders, 3–5% brand accent, less than 1% warning/danger unless needed.

Gradients are only for the WeVid logo, primary CTA, active nav indicator, wallet/trust proof chip, unlock/support payment CTA, Studio/Enterprise badges, and rare hero moments.

## 4. Layout rules

Use one adaptive shell.

Desktop:
- Persistent left rail.
- Persistent top bar with search, notifications, wallet, avatar/menu.
- Prefer 62/38 or 70/30 content/detail splits.
- Keep important actions above the fold.
- Secondary tools can be visible in the rail/menu, but primary nav stays five items.

Mobile:
- Bottom nav stays visible except immersive media states.
- Use safe-area insets: `env(safe-area-inset-*)`.
- Main actions sit in the thumb zone.
- Use sheets for comments, share, support, unlock, filters, wallet, and menus.
- One primary CTA per screen or sheet.

Breakpoints:

```txt
< 640px     mobile
640–1023px  tablet / compact shell
>=1024px    desktop shell
>=1440px    wide desktop with optional right panel
```

Touch targets: minimum 44px practical size, 48px preferred for primary actions.

## 5. PWA / native-app feel

Use Next.js App Router with a persistent protected AppShell. Server components fetch stable data; client components handle player, gestures, sheets, haptics, optimistic actions, and transitions.

PWA requirements:
- Manifest with app name, icons, theme colors, display standalone.
- Service worker caches app shell and static assets only; never cache private media tokens, wallet secrets, raw provider payloads, or identity data.
- Offline fallback: app shell + “connection needed” states.
- Push notifications are opt-in and used for messages, Mutuals, purchases, live/events, creator/admin alerts.
- Use route prefetch and optimistic UI for follow, like, save, connect, and simple message actions.
- Use skeletons for media/feed/cards, not spinners.
- Keep perceived response below 100ms for taps with immediate pressed/haptic feedback.

Optional haptics:

```ts
if ('vibrate' in navigator) navigator.vibrate(8)
```

Use haptics only for clear actions: nav select, like/connect, unlock success, publish confirmation, payment success.

## 6. Motion and gesture system

Motion should feel like a native premium app: fast, smooth, restrained.

```txt
Tap feedback:        80–120ms
Micro state change:  120–160ms
Nav/view transition: 160–240ms
Sheet open/close:    220–320ms
Heavy loading:       progress/status required after 1s
```

Use CSS transitions, View Transitions, scroll-snap, and GSAP only where it improves clarity. No toy bounce, no excessive parallax, no neon motion spam.

Critical actions must always have visible controls. Gestures are shortcuts, not the only path.

### Core gestures

Home:
- Vertical scroll through mixed feed.
- Tap media opens `/app/media/:id` viewer.
- Support/unlock opens sheet.

Bits:
- Vertical snap feed.
- Swipe up = next Bit.
- Swipe down = previous Bit.
- Tap creator = profile overlay.
- Tap comments = bottom sheet.
- Long press = pause.
- Double tap = like.

Media viewer:
- Tap media = play/pause.
- Swipe down/back = close on mobile where safe.
- Comments/share/support/unlock use sheets.

Create:
- No global swipe gestures.
- Stepper controls only: Media, Details, Teaser, Monetization, Event, Preview, Publish.

Messages:
- Thread full-screen on mobile.
- Share inside WeVid and external share are separate flows.

Mutuals:
- No separate Mutuals discovery screen.
- Mutuals is enabled in Profile Settings > Privacy & Safety.
- If both viewer and creator have Mutuals enabled, media shows Connect.
- Mobile shortcut: swipe right = Connect, swipe left = Pass.
- Creator gets notified.
- If both connect, create a Mutual.
- Mutuals appear inside Messages as Mutual-tagged conversations.

## 7. Screen contracts

Landing:
- One-screen hero.
- Header nav: Start, Watch/Create, Why WeVid, Earn, Partners, Trust.
- GSAP-style video-frame scroll: scrolling advances hero frames/topics inside the same screen, not many redirects.
- CTAs: Start onboarding, Log in / Enter.
- Footer legal links open centered modal; user can expand/open new tab.

Onboarding:
- Identity + profile + wallet in one guided step.
- Then age verification.
- App shell only after required gates pass.

Home:
- Mixed media feed with live rail, stories/moments, creator suggestions, create/go-live CTA.

Bits:
- Immersive vertical feed, one-thumb actions, right rail, bottom sheets.

Create:
- KYC-gated.
- Resumable upload.
- Autosave drafts.
- Explicit publish confirmation.

Profile:
- One profile for identity, content, stats, activity, creator readiness.
- Activity lives inside profile, not primary nav.

Messages:
- Inbox, requests, Mutuals tags, rich shares, paid messages, safety controls. (gates for new message from viwer/other user who is not already mutual, or following each other needs acapt message from reciever, so we avoid spaming, so user can send first two message to somene but if htey are not accepted no read status or more messages are enabled, reviver can accept, decline, or block/report (this protection is just for regular messages, not for comments, payed messages or messages between mutuals, or profiles who already follow each other)).

Wallet:
- Non-custodial wallet state, linked wallets, top-up, receipts.
- Funding wallet does not unlock content by itself.

Subscriptions:
- Platform plans and creator memberships are separate.
- Plans unlock tools/features, never ranking, reach, Mutuals boost, or social priority.

Settings:
- Account, Privacy & Safety, Mutuals toggle, notifications, connected accounts, blocks, data requests, deletion.

Studio / Enterprise / Assistant / Admin:
- Studio and Enterprise are capability-based secondary workspaces.
- Assistant requires explicit confirmation for publish, admin, money, or provider-impacting actions.
- Admin is separate and role-gated.

## 8. Trust, safety, money, and conversion rules

Always make these actions explicit and visible:
- Pay / unlock / support / tip.
- Publish.
- Report / block / hide / not interested.
- Mutuals connect/pass.
- Event access.
- Wallet connection.
- Age/KYC/KYB status.

Never imply WeVid custodies user funds. Use language like:

```txt
Your wallet. Your keys.
WeVid never holds your funds.
Access unlocks after confirmed payment.
Receipts are server-generated records.
```

High-converting WeVid UI means: fewer visible choices, clear hierarchy, instant feedback, trusted payment wording, no surprise redirects, and one obvious next action.
