# Manual QA runbook (CoachXYZ — accessibility, keyboard, responsive)

This runbook covers checks that are **not** fully provable from automated tests in this repo (jsdom/node-only component tests, no real browser/device AT in CI). Use it for release hardening across dashboard, org, player, share, and auth-adjacent flows.

**Not claimed done by automation:** screen-reader speech/announcement order, real focus cursor behavior in shipped browsers, touch ergonomics on physical devices, zoom/reflow on real viewports, platform-specific assistive technology quirks, and real media/network/storage behavior.

## Preconditions

- Local app running with representative data (coach/admin/owner account as available), an org with students, teams/members, schedule events, attendance records, reports, and at least one completed and one in-progress analysis; a shareable analysis/token if the feature is enabled.
- Services/env configured as needed for the flow under test (Auth0 login, `NEXT_PUBLIC_API_URL` → server, shared `SERVICE_TOKEN`, DB, email/Resend only if testing invite/report/attendance delivery; engine/media deps only if testing real analysis playback/processing).
- Test in both light and dark themes where relevant.
- Desktop viewport (~1280px+), tablet (~768–1024px), and narrow mobile (~360–390px). Include 200% browser zoom / large-text pass on key screens.
- Browsers: latest Chrome/Edge + Firefox + Safari where available. Record browser + AT + OS version for screen-reader passes.

## Surfaces and routes to cover

### Auth-adjacent and public entry points
- `/` (marketing landing), `/login`, `/signup`, `/account` (account/profile surface), `/invite` (accept invite flow)
- Marketing pages as present: `/about`, `/blog`, `/blog/[slug]`, `/contact`, `/features`, `/pricing`, `/privacy`, `/terms`
- Error/not-found states: app 404/not-found, dashboard not-found/error/loading where applicable

### Coach/dashboard workspace (`/dashboard`)
- `/dashboard` (home; role-specific cards/sections)
- `/dashboard/analyze`, `/dashboard/analyse` (legacy path if present), `/dashboard/new-analysis` (upload/start analysis entry points)
- `/dashboard/history` (analysis history list)
- `/dashboard/analysis/[id]` (analysis detail) and `/dashboard/analysis/[id]/chat`
- `/dashboard/students`, `/dashboard/students/[id]`
- `/dashboard/teams`, `/dashboard/members`
- `/dashboard/schedule`
- `/dashboard/attendance`
- `/dashboard/reports`, `/dashboard/reports/[id]`
- `/dashboard/settings`, `/dashboard/audit`, `/dashboard/help`, `/dashboard/news`, `/dashboard/org`, `/dashboard/support`, `/dashboard/features` (as present/enabled)

### Player hub (`/player`)
- `/player` (player home)
- `/player/reports/[id]`
- `/player/settings`

### Share
- `/share/[token]` (public/read-only shared analysis view; valid token, expired/invalid token states)

## Custom widgets and interaction checks

Verify each widget with keyboard, screen reader, and narrow/zoomed layouts where applicable.

| Widget / area | Where | Checks |
| --- | --- | --- |
| Global search (`Ctrl+K` / trigger) | Dashboard shell/topbar (`components/GlobalSearch.tsx`) | Trigger discoverable and named; `Ctrl+K` and `/` open dialog (without stealing focus while typing in inputs). Dialog announced with accessible name ("Search"), input labelled (not placeholder-only). Quick links shown on empty query; async states (searching/error/no results/results) announced/perceivable. Result items actionable, selection navigates, Escape/selection closes and restores focus to a sensible control. No horizontal overflow on small screens. |
| Sidebar quick find | Dashboard sidebar (`components/SidebarSearch.tsx`) | Trigger named ("Search or ask" / `Ctrl+K` affordance), dialog announced ("Quick find"), input labelled. Typing filters pages and loads player matches (debounced). Arrow Up/Down changes active result and is perceivable (selection/state announced), Enter activates, mouse hover updates active item, Escape closes and restores focus. Empty, searching, no-match, and player-search-failure/partial-failure states are accurate and announced (not claiming "no player" on a failed read). |
| Mobile nav drawer | Dashboard below `md` (`components/MobileNavDrawer.tsx`) | Sticky bar + hamburger reachable, `expanded` state reflects open state, dialog labelled with workspace navigation, focus moves inside on open and is trapped while open, Escape/close button/backdrop behavior dismisses correctly, link tap navigates and closes without stealing focus incorrectly, footer/account area reachable, scrollable content usable, no background scroll bleed. Closed content must not be tabbable. |
| Marketing nav menus | Marketing header/pages (`components/HeaderClient.tsx`, `components/MarketingLanding.tsx` and related) | Desktop/mobile menu toggles named and stateful, menu items keyboard reachable, submenus/popovers (if present) operable without pointer, Escape closes transient menus, focus order predictable, no clipped/overflowing menus at narrow widths. |
| Notification bell | Dashboard header (`components/notifications/NotificationBell.tsx`) | Trigger named ("Notifications"), unread badge/count conveyed in text, menu/popover opens and lists items with title/body/time/read state (not color-only). Loading, load-failure, and empty states accurate. Mark-read and mark-all actions update state; failures surfaced and do not leave false "read" claims. Keyboard activation and focus behavior sane. |
| Dialogs/modals | Share dialog, student/event/report/attendance/invite/import forms, confirmations (`components/interior/modal.tsx`, `components/AnalysisDetailClient.tsx`, org dialogs) | `dialog` role/name announced from title, initial focus inside, focus trapped, Escape/close button dismisses and restores focus to invoker, scrim not announced as extra control, body scroll locked appropriately, content scrolls within viewport on small screens and actions remain reachable. Share dialog: "Share link" field labelled/read-only, copy action discoverable, loading/error/retry/expiry states reachable and announced. |
| Drawers / side panels | Analysis metadata drawer and other panels (`components/interior/drawer.tsx`) | Announced as dialog with title, content reachable in order, close control named, Escape closes, focus restored, closed drawer content not reachable/inert. |
| Lightbox / media preview | Image/video preview surfaces (`components/interior/lightbox.tsx`) | Dialog named, close control reachable, media accessible (alt/caption/controls as applicable), focus trapped/restored, Escape closes. |
| Popovers/tooltips | Click/hover info surfaces (`components/interior/popover.tsx`, 9ui tooltip/popover usage) | Trigger state/description announced where implemented, content readable when shown, keyboard activation supported for click popovers, Escape dismisses and returns focus appropriately. |
| Dropdowns/selects/menus | 9ui/Base UI controls across forms/tables (`components/9ui/ui/select.tsx`, dropdown menus) | Trigger has accessible name, value/selection announced, options keyboard navigable, expanded/collapsed state announced, no off-screen clipping on mobile. |
| Hold-to-confirm | Destructive/confirm actions (`components/interior/hold-to-confirm.tsx`, e.g. analysis delete) | Keyboard-operable alternative behavior clear, progress/confirmation state perceivable, action label specific, focus remains logical after completion/cancel. |
| Video player, timeline, key moments | Analysis detail/share (`components/VideoPlayer.tsx`, `app/share/[token]/page.tsx`) | Native controls operable by keyboard/screen reader. Timeline slider labelled and exposes value/time text; keyboard seeking works (arrows/page/home/end as supported). Key moments list/buttons named with timestamp/event context and seek correctly. Fallback/error states ("Video unavailable") announced. Layout scales without horizontal overflow. |
| Findings timeline / actions | Analysis detail (`components/FindingsTimeline.tsx`) | Each finding reachable; seek action focusable/activatable when enabled. Category/severity/confidence/review state/time/diagnostics conveyed in text. Approve/Flag controls named, disabled/saving states clear, errors announced (`alert`) and do not falsely mark saved state. |
| Analysis link control | Analysis detail (`components/org/AnalysisLinkControl.tsx`) | Trigger exposes linked/unlinked state, dialog/panel labelled, roster loading/failure/empty states accurate (do not hide or misstate an existing link), unlink action available when linked, student choices keyboard reachable, focus/escape behavior correct. |
| Schedule grid / agenda | `/dashboard/schedule` (`components/org/ScheduleClient.tsx`) | Month/week/grid and list/agenda views (as implemented) navigable by keyboard; date/event controls named; create/edit dialogs usable; no pointer-only critical actions; dense grids remain usable on small screens (scroll/stack behavior intentional) and controls not clipped. |
| Attendance | `/dashboard/attendance` (`components/org/AttendanceGrid.tsx`) | Table/grid semantics and row/student/date context announced, status controls keyboard operable, bulk/actions and email/attendance dialogs labelled, loading/error/empty states accurate. |
| Charts / data tables | Dashboard/reports/student profile charts and tables (`components/9ui/ui/chart.tsx`, `components/org/PerformanceChart.tsx`, report/student tables) | Essential values not conveyed by color alone (text/table/labels available), charts scale to container, legends/labels not clipped at narrow widths, tables provide headers/context and horizontal scroll only where intended. |
| Reports and export/share actions | `/dashboard/reports`, `/dashboard/reports/[id]`, player/share report views | Report content structured with headings, print/share/email actions named, dialogs/forms validated and announced, long text/IDs wrap safely. |
| Forms and settings | Settings/account, org CRUD dialogs, invite/import, schedule/event forms | Every input/select/textarea has a programmatic label, required/invalid states announced, inline/server errors associated and announced, save/loading states clear, destructive actions confirmed. |

## Screen-reader focused passes

Run on NVDA/VoiceOver/JAWS where available (record browser + AT + OS):

- Landmarks/nav, dialog/drawer names, expanded/collapsed states, and focus movement on open/close.
- Async status/error announcements: search results, notifications load/failure, share-link creation/retry, findings review save errors, copy-to-clipboard confirmation.
- Table/header/row context and status pills (text, not color-only) in students/attendance/schedule/reports/audit/members views.
- Read-only surfaces (player hub, share view) expose headings, metrics, and media with labels/alternatives and no unlabeled interactive controls.

## Keyboard-only (no mouse)

Verify Tab/Shift+Tab order, visible focus, Enter/Space activation, Escape dismissal, and no focus traps outside dialogs.

- **Global:** focus lands on meaningful controls; `/` and `Ctrl+K` shortcuts behave and do not steal focus while typing in inputs. Focus ring visible in light/dark.
- **Dialogs/drawers/lightbox:** initial focus inside, Tab cycles within, Escape closes, focus returns to opener.
- **Menus/selects/combobox-like search:** open/navigate/select/close per component behavior; SidebarSearch arrow-key active result, Enter activation, and Escape close.
- **Custom widgets:** popovers closable by Escape; analysis link panel focusable/closable; hold-to-confirm operable; video timeline slider and key-moment buttons operable.
- **Findings timeline:** seek buttons and Approve/Flag actions reachable; disabled/saving states clear.
- **Schedule/attendance:** date navigation, cell/event actions, and any non-pointer alternatives usable.
- **Share flow:** open Share, reach read-only URL field and Copy action, retry/error states keyboard reachable.

## Touch targets and responsive layout

Check at ~360px, ~390px, ~768px, and with zoom/text scaling.

- Interactive controls comfortably tappable (target ~44x44 CSS px where feasible); icon-only buttons have adequate hit area.
- No horizontal page overflow in primary flows: dashboard home, students/teams/members, student profile, attendance, schedule, reports, history, analysis detail/chat, settings/account, player hub, share view, auth-adjacent entry points.
- Long identifiers/URLs (share links, job IDs, names, criteria/provenance text) wrap or scroll locally without breaking layout.
- Tables/grids remain usable on small screens (intended horizontal scroll, no clipped controls/content).
- Dialog/sheet content scrolls within viewport; actions remain reachable.
- Charts/media scale to container; no clipped legends/labels that hide essential information.

## Focus/announcement order spot checks

- After async actions (save, send, generate share link, load failures, copy) focus moves to a logical target or a status/`alert` is announced.
- Route/page transitions expose a clear heading/title first.
- Dynamic count/badge changes (notifications, search results) do not cause confusing focus jumps.

## Reporting

Log issues with: flow/surface, route, steps, viewport/zoom, browser/OS/AT, expected vs actual, screenshot/recording, and severity (blocker/serious/moderate/minor). Note whether the issue is reproducible only with real services/data (Auth0, DB, engine/media, Resend, network).
