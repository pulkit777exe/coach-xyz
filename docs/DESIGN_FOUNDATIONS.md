# Design foundations — typography, UI libraries, role-based IA

Contract for everything visual in `web-next/`. Companion to
`docs/CODEBASE_MAP.md` (role matrix, server gaps) and `AGENTS.md` (frontend
conventions). Tokens live in `app/globals.css`; the two approved UI libraries
are **9ui** (structural primitives) and **interior.dev**
(micro-interactions). Rules below derive from the `better-typography` skill
(see "Verification" for what was and wasn't machine-checked).

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

**Not verified**: a browser resize pass at real content lengths (widows,
wrapping) — do it before calling a surface final.

## UI libraries

### 9ui — structural primitives (`components/9ui/ui/`)

Base UI + Tailwind, copy-paste, themed entirely by our semantic tokens.

- **Vendored (14)**: avatar, badge, button, card, chart, checkbox, dialog,
  dropdown-menu, input, label, select, sonner, switch, textarea.
  Usage leaders: `button` (×48), `input` (×19), `label`/`dialog` (×17),
  `select` (×11).
- **Offered, not yet vendored**: accordion, alert, alert-dialog, aspect-ratio,
  autocomplete, breadcrumbs, calendar, carousel, collapsible, combobox,
  command, context-menu, date-picker, drawer, emoji-picker, form, input-otp,
  kbd, menubar, meter, navigation-menu, number-field, pagination, phone-input,
  popover, preview-card, progress, radio-group, resizable, scroll-area, sheet,
  skeleton, slider, table, tabs, toast, toggle, toggle-group, toolbar,
  tooltip.
- **Rule**: never hand-roll a primitive 9ui offers. Vendor it
  (`npx shadcn@latest add @9ui/<name>`, output into `components/9ui/ui/` —
  never legacy `components/ui/`) and theme through tokens only.
- **Next to vendor**: `skeleton` (loading states in `MobileNavDrawer`,
  `StudentProfile`, `SettingsClient` are ad-hoc today), `tooltip` (generic
  hints). Bespoke overlays in `PerformanceChart` / `VideoPlayer` are
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

### States contract (every data surface)

1. **Loading** — skeleton or progress (9ui `skeleton` once vendored;
   interior `progress-bar` for async jobs).
2. **Empty** — `EmptyState` describing the page's purpose + a role-gated CTA
   (`action` prop) when the role may act (students/teams/reports do this).
3. **Error** — inline banner or error text; never a blank card.
4. **Denied** — `AccessDenied`, in the page gate, before fetching.

## Verification

- `npm run typecheck && npm run lint && npm run test && npm run build` green;
  files new to the repo prettier-clean.
- Contract tests pin the role matrix, route floors, and quick-action tiles
  (`web-next/lib/__tests__/permissions.test.ts`).
- Per-persona browser assertion matrix (curl harness) in light + dark, with
  screenshots for gated surfaces — 33 rows across 5 personas (owner, analyst,
  medical, player, realowner), 0 failed / 0 blocked; the page cache is
  cleared per run so rows verify the current render.
- **Not verified here**: browser resize pass at real content lengths (see
  Typography).
