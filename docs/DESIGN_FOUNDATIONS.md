# Design foundations — typography, UI libraries, role-based IA

Contract for everything visual in `web-next/`. Companion to
`docs/CODEBASE_MAP.md` (role matrix, server gaps) and `AGENTS.md` (frontend
conventions). Tokens live in `app/globals.css`; the two approved UI libraries
are **9ui** (structural primitives) and **interior.dev**
(micro-interactions). Rules below derive from the `better-typography` skill
(see "Verification" for what was and wasn't machine-checked).

## Tokens — color SSOT

`app/globals.css` is the only place raw color values may live: light on
`:root`, dark on `.dark`, surfaced to Tailwind via `@theme inline`. Groups:

| Group      | Tokens                                                                          | Notes                                                                                                   |
| ---------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Surfaces   | `background`, `card`, `popover`, `muted`, `sidebar`, `topbar`                   | one token per structural surface                                                                        |
| Ink        | `foreground`, `foreground-strong`, `muted-foreground`                           | strong = emphasis ink (`#ececec` in dark) — marketing headings/bold run one step hotter than body ink   |
| Brand      | `primary` (+ `-hover`), `link`, `score`                                         | `link` is the text-blue (`#2383e2` light / `#4da3ec` dark); fills and dots use `primary` in both themes |
| Borders    | `border`, `input`, `border-hover`, `sidebar-border`, `topbar-border`            | hairline ladder; topbar/sidebar carry their own exact hairlines                                         |
| Hover fill | `accent`, `surface-hover`, `fill-quiet`, `fill-quiet-hover`                     | `surface-hover` = card hover fill (`#fafafa` / `#1e1e1e`); quiet fills are the ⌘K search affordance     |
| States     | `danger` / `warning` / `info` / `success` (+ `-foreground`, `-border`), `check` | badges, banners, denied/empty states; `check` = static tick green (identical both themes)               |
| Charts     | `chart-1…5`                                                                     | data-viz only                                                                                           |

Call-site rules:

- **No hex/rgba colors in `.tsx`.** Allowed literals: shadow specifications
  and media/canvas drawing (e.g. `VideoPlayer` score fills — media-space, not
  theme-space).
- **Never hand-write a `dark:` pair.** If a value differs by theme it is a
  token; if the pair has no token yet, add one value-exact (that is how
  `link`, `foreground-strong`, `surface-hover` and `border-hover` landed).
- **Resting states stay pixel-exact — sole exceptions: the hairline
  reconciliations below, all ≤ 5/255 alpha; interactive states unify on the
  hover ladder.** Documented reconciliations from the hex migration:
  `#1b6fb8` hand-rolled CTA hovers (background **and text**) →
  `--primary-hover` — light becomes #1a73c9 (Δ17/255) and dark flips from
  #1b6fb8 to #4a94e0, so both themes hover like every 9ui Button (the
  hand-rolled hover had no `dark:` variant); border hairlines move ≤
  5/255 alpha (marketing dark `.08` → `border` `.09`, outline-button dark
  `.15` → `input` `.14`); blog card hover `.20/.18` → `border-hover`
  `.18/.16`.
- Tinted blue (pills, icon chips) is `primary` at opacity, never `link` —
  `primary` is identical in both themes, so `/10` `/20` `/30` mods never
  shift between light and dark.
- The legacy `--marketing-*` alias layer was deleted (zero call sites);
  semantic tokens are the safety net.
- Color migration status (round 10, 2026-09-25): **zero** raw hex/rgba
  classes remain in first-party `web-next/**.tsx` — marketing was the last
  holdout (~360 substitutions this round, on top of the earlier app/dashboard
  sweep). Remaining literal colors are exactly the allowed cases above,
  plus token opacity halves like `dark:bg-white/8` (`white` is a theme
  color, not a leftover).

## Typography

Notion pixel-matched, light + dark. Faces via `next/font` (self-hosted woff2):
Inter 400/500/600/700 **plus the real italic style** (the marketing blockquote
renders italic — never let the browser synthesize it), JetBrains Mono 400/500.

### Type scale — deviate as little as possible

| Size           | Use                                 | Canonical site                  |
| -------------- | ----------------------------------- | ------------------------------- |
| 40px bold      | display numerals (404, pricing)     | `app/not-found.tsx`             |
| 30–32px bold   | page `h1`                           | `components/org/PageHeader.tsx` |
| 28px semibold  | dashboard metric value              | `StatTiles` (OwnerHome)         |
| 18px semibold  | stat / callout value                | history summary                 |
| 15px medium    | empty-state title                   | `components/org/EmptyState.tsx` |
| 14px           | body + UI default (tables, buttons) | everywhere                      |
| 13px           | breadcrumb, section heading, meta   | `PageHeader` / `SectionHeading` |
| 12px           | captions, stat meta                 | `StatTiles`                     |
| 11px uppercase | metric labels, `tracking-[0.08em]`  | `metricLabelClass`              |

### Semantic size utilities

Six **font-size-only** utilities in `globals.css` (`@utility`, driven by the
`--text-*` vars): `text-label` (11px), `text-caption` (12px), `text-meta`
(13px), `text-body` (14px), `text-title` (15px), `text-lead` (16px). They
emit font-size alone — line-height, weight and tracking stay per the rules
below at the call site, so `text-meta` is pixel-identical to `text-[13px]`
while the scale itself moves from one place. Prefer them over `text-[Npx]`
whenever the size is one of the six; pinned by
`lib/__tests__/typeScale.test.ts`.

**Everything above 16px is bespoke**, and bespoke is permitted in the
component that owns it — 18px sub-headings, 26–68px marketing display,
28–40px page headings, 44px stat figures (`PageHeader`, `StatTiles`, hero
sections). The one rule is "outside the six and above the floor", rather
than an enumerated list of sizes: this paragraph previously named
*28–40px and 56/68px* while the journey table below named *26–68px*, so
the 11 first-party sites at 26px and 44px were simultaneously violations
and permitted depending on which sentence a reader stopped at, and the 8
sites at 18px were named by neither. `lib/__tests__/bespokeTypeSizes.test.ts`
now parses the range below and fails if a first-party literal size falls
outside it, so the prose is load-bearing rather than decorative.

**Below 11px is NOT bespoke** — it is a named exception, because there is
no seventh rung below the floor and adding one is a design decision rather
than a refactor. The five current sites (a 9px count badge, a 10px
`<kbd>`, three 10px marketing dividers) are counted and rot-checked by
`lib/__tests__/typeScaleComponents.test.ts`, and the floor is pinned from
both sides so a `>= 17` style escape hatch cannot quietly admit 10px.

Vendored files (`components/9ui/**`, `components/interior/**`) stay
registry-faithful and keep their own sizes. Round 10 adopted the utilities
first-party-wide — **538 swaps** (430 core + 108 marketing/settings tail);
the only literal `text-[Npx]` left in the repo are vendored
`components/interior/**` (16) and comment references.

### Rules

- **Line-height**: headings `1.1–1.2`, body `1.5–1.6`, always unitless.
  `leading-none` only on one-line numerals/labels — never on text that can
  wrap to 3+ lines (that needs ≥ 1.4).
- **Letter-spacing**: negative on ≥ 28px headings (`tracking-[-0.015em]`);
  positive on uppercase ≥ 11px; none at reading sizes.
- **Weights**: ≥ 400 below 18px; weights under 300 are display-only ≥ 28px.
  Load the real face for every weight/style in use — no `font-synthesis`.
- **Tabular numerals**: `tabular-nums` on every changing value — dates,
  scores, counts, durations, prices.
- **Wrap**: `text-wrap: balance` on `h1–h6`, `pretty` on body/descriptions
  (both set in the `globals.css` base layer); `overflow-wrap: break-word`
  where a URL/id could escape; `nowrap` only on labels/badges.
- **Truncation**: `truncate`/`line-clamp` only when the full value stays
  reachable (tooltip, detail page, expanded view).
- **Measure**: long-form prose ≤ 75ch; page descriptions `max-w-[640px]`.
- **Inputs**: 16px on mobile — the 9ui Input ships `text-base md:text-sm`;
  never override with a raw `text-sm` (iOS zooms otherwise).
- **Font smoothing**: once on the root (`globals.css`), never per component.
- **Punctuation**: en dash for ranges (`2010–2020`), a real `…`, curly quotes
  in prose / straight in code; store copy in natural case and style with
  `text-transform`.

**Verified (round 11)**: a programmatic resize pass over 8 surfaces × {375,
768} × {light, dark} — 32/32 with zero page-level horizontal overflow, zero
console/page errors, and no unintended text clipping (the only hits are
`.sr-only` content and deliberate `truncate`). Real-content widows/wrapping
still deserve a human eye on long org names and long athlete names.

## UI libraries

### 9ui — structural primitives (`components/9ui/ui/`)

Base UI + Tailwind, copy-paste, themed entirely by our semantic tokens.

- **Vendored (15)**: avatar, badge, button, card, chart, checkbox, dialog,
  dropdown-menu, input, label, select, skeleton, sonner, switch, textarea.
  Usage leaders: `button` (×48), `input` (×19), `label`/`dialog` (×17),
  `select` (×11).
- **Offered, not yet vendored**: accordion, alert, alert-dialog, aspect-ratio,
  autocomplete, breadcrumbs, calendar, carousel, collapsible, combobox,
  command, context-menu, date-picker, drawer, emoji-picker, form, input-otp,
  kbd, menubar, meter, navigation-menu, number-field, pagination, phone-input,
  popover, preview-card, progress, radio-group, resizable, scroll-area, sheet,
  slider, table, tabs, toast, toggle, toggle-group, toolbar,
  tooltip.
- **Rule**: never hand-roll a primitive 9ui offers. Vendor it
  (`npx shadcn@latest add @9ui/<name>`, output into `components/9ui/ui/` —
  never legacy `components/ui/`) and theme through tokens only.
- **Next to vendor**: `tooltip` (generic hints). Loading states use the
  vendored `skeleton` (`org/StudentProfile` chart fallback); spinners and
  em-dash placeholders are deliberate choices in `SettingsClient` and stay.
  Bespoke overlays in `PerformanceChart` / `VideoPlayer` are
  chart/player-specific and stay hand-rolled.

### interior.dev — micro-interactions (`components/interior/`)

One file per moment (MIT, needs `motion`), organized by what the user is in
the middle of: Action Feedback, Input, Async, Notification, Overlay,
Navigation, Scroll, Data, Gesture, Content.

- **Vendored (15)**: copy-button, drawer, hold-to-confirm, lightbox,
  loading-button, modal, poll-results, popover, progress-bar, reading-progress,
  reorder-list, scroll-spy, segmented-control, show-more, tree-view.
- **Consumers**: `AnalysisDetailClient` (13 components), `AnalysisProgress` /
  `AppClient` / `PlayerHub` (`progress-bar`).
- **Rule**: the small finished behaviors come from here — async progress,
  hold-to-confirm for destructive actions, loading buttons that don't resize,
  exit-fade overlays. Don't rebuild them inline; don't use them where a plain
  9ui primitive is the right shape.

### Arbitration

| Need                                         | Use                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| Button, badge, form field, menu, table cell  | 9ui                                                                           |
| Dialog containing a form                     | 9ui `dialog`                                                                  |
| Imperative overlay flow (exit-fade contract) | interior `modal` / `drawer`                                                   |
| Menus (account, org switcher)                | 9ui `dropdown-menu` (the shared pattern)                                      |
| Loading button, progress, hold-to-confirm,   | interior                                                                      |
| copy, segmented control                      |                                                                               |
| Content placeholder while data loads         | 9ui `skeleton` (never a hand-rolled pulsing div)                              |
| Theming                                      | semantic tokens only (`bg-card`, `border-border`, `text-muted-foreground`, …) |

## Motion

Tokens in `globals.css`: `--dur-fast/base/slow` = 120/180/240ms (all < 300ms);
`--ease-out` in, `--ease-in` out; press = `scale(0.98)`; overlays dim rather
than shadow-float; entrance animations are capped at `--dur-slow` regardless
of call-site shorthand. Reduced motion (OS setting or `.reduce-motion`)
collapses movement to a 120ms opacity fade — information always arrives.

## Role-based IA (feature-clarity contract)

Every persona lands on a surface that shows **their** primary actions, and no
tile/button may dead-end into a page that renders read-only or denied for
them. Gating layers, outermost first:

1. **Nav** — route lists in `lib/nav` filter sidebar/drawer/search items.
2. **Page gate** — `AccessDenied` (title, allowed roles, way back) renders
   _before_ any data fetch on members/audit/history.
3. **Capability props** — `lib/permissions` booleans computed in RSC pages and
   threaded down; hide or omit what the server would reject.

`dashboardQuickActions(role)` derives the landing tiles (New analysis /
Add student / Schedule event / Invite member) from the same permission
source; pinned in `lib/__tests__/permissions.test.ts`.

| Persona            | Landing                | Quick actions                       | Key affordances                                                                 | Denied treatment                                                                                                        |
| ------------------ | ---------------------- | ----------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| owner / admin      | `/dashboard` OwnerHome | all four tiles                      | full write toolbars everywhere                                                  | —                                                                                                                       |
| head_coach / coach | CoachHome              | New analysis, Add student, Schedule | team manage, report draft + AI send                                             | invite hidden on members page (floor)                                                                                   |
| assistant_coach    | CoachHome              | New analysis, Schedule              | report draft + AI send, no team reshape                                         | add-student / team-manage hidden                                                                                        |
| analyst            | CoachHome              | New analysis, Schedule              | report draft (no AI/email), read-only roster                                    | members/audit → AccessDenied; invite/add/new-team hidden                                                                |
| medical            | CoachHome              | Schedule                            | read-only students/teams/reports; no stat tiles or Recents (account-data floor) | history/members/audit → AccessDenied; History + New Analysis absent from nav/palette; Recents hidden                    |
| player             | `/player` PlayerHub    | Analyze My Video                    | own reports → detail pages                                                      | no staff nav; `/dashboard` bounces to `/player`; topbar has no org pill or Dashboard CTA; foreign report id → not-found |

### Settings center

One role-aware panel; sections appear by capability, never by hiding a
disabled control. Order is stable: My account · Security · Preferences ·
Notifications · Privacy & data, then the org-only blocks (Organization,
Members, Plan & usage, Records) on the dashboard variant.

| Section        | Who sees it | What it owns                                                             |
| -------------- | ----------- | ------------------------------------------------------------------------ |
| My account     | everyone    | name, nickname, picture                                                  |
| Security       | everyone    | verified email, password deep link, log out                              |
| Preferences    | everyone    | theme, reduce motion, week start — device-local, mirrored to the account |
| Notifications  | everyone    | in-app master, per-event switches, email digest cadence                  |
| Privacy & data | everyone    | consent per purpose, data download, deletion request                     |
| Organization   | dashboard   | club name + timezone (owner/admin edit, everyone else reads)             |
| Members        | dashboard   | staff list, invites, roles, player roster                                |
| Plan & usage   | owner/admin | tier and today's usage                                                   |
| Records        | dashboard   | metric tiles                                                             |

Two rules the settings surface follows:

- **Device-local first, account-mirrored.** Theme/motion/week-start render
  from local state and write through in the background, so a toggle never
  waits on the network. A first-time account (no stored row) keeps the
  device's choice rather than being reset to the server default.
- **Email is a digest, never a message per event.** `cadence` is
  `instant` (the default: in-app only) or `daily` / `weekly`, which send one
  summary of what was missed. The in-app switch and the digest are
  independent; per-event opt-outs are re-checked when the digest is built,
  so muting an event also removes it from a digest you had not received yet.

### States contract (every data surface)

1. **Loading** — skeleton or progress (9ui `skeleton` for content
   placeholders; interior `progress-bar` for async jobs).
2. **Empty** — `EmptyState` describing the page's purpose + a role-gated CTA
   (`action` prop) when the role may act (students/teams/reports do this).
3. **Error** — inline banner or error text; never a blank card.
4. **Denied** — `AccessDenied`, in the page gate, before fetching.

## Surfaces & flows (what the foundation serves)

| Flow               | Surfaces                                                                 | Foundation in play                                                                                   |
| ------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Discover → sign up | `/`, `/pricing`, `/features`, `/blog`, `/login`, `/signup` (topbar only) | theme-aware token pairs, CTA ladder `primary → primary-hover`, bespoke display type (above 16px)        |
| Coach work session | `/dashboard/*` — sidebar shell, tables, dialogs, forms                   | 9ui primitives, `tabular-nums` metrics, states contract, `dashboardQuickActions(role)` gating        |
| Player session     | `/player` — topbar-only shell (no org pill, no Dashboard CTA)            | `PlayerHub` + interior `progress-bar`, analyze CTA                                                   |
| Analysis run       | upload → `AnalysisProgress` → `ResultsSummary` → `VideoPlayer` → chat    | interior `progress-bar`/`loading-button`, `--dur-*` motion, media-space colors (player overlay only) |
| Report & share     | org reports → email → `/share/[token]` (read-only, shell-less)           | same tokens without sidebar/topbar; `background` surface reads light in print-like contexts          |

Every flow lands on a themed, tokenized surface; no flow has its own color
vocabulary.

## Verification

- `npm run typecheck && npm run lint && npm run test && npm run build` green;
  files new to the repo prettier-clean.
- Contract tests pin the role matrix, route floors, and quick-action tiles
  (`web-next/lib/__tests__/permissions.test.ts`).
- Per-persona browser assertion matrix (curl harness) in light + dark, with
  screenshots for gated surfaces — 33 rows across 5 personas (owner, analyst,
  medical, player, realowner), 0 failed / 0 blocked; the page cache is
  cleared per run so rows verify the current render.
- **Resize pass (round 11)**: 8 surfaces × {375, 768} × {light, dark} —
  0 page overflow, 0 console errors; see Typography.
- **Interaction states (round 11)**: header/CTA hover sampled from rendered
  pixels — `rgb(26,115,201)` light and `rgb(74,148,224)` dark (both
  `--primary-hover`), sidebar hover and keyboard focus ring captured.
- **Still open**: real-persona Auth0 records for the coach and player test
  accounts (synthetic subs cover every matrix row until then).
