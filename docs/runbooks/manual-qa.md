# Manual QA runbook (accessibility, keyboard, responsive)

This runbook covers checks that are **not** fully provable from automated tests in this repo (no browser/device AT in CI, jsdom/node-only component tests). Use it for release hardening across dashboard, org, player, share, and auth-adjacent flows.

**Not claimed done by automation:** screen-reader speech/announcement order, real focus cursor behavior in shipped browsers, touch ergonomics on physical devices, zoom/reflow on real viewports, and platform-specific assistive technology quirks.

## Preconditions

- Local app running with representative data (coach/admin account, org with students/schedule/reports, at least one completed and one in-progress analysis, a shareable analysis if enabled).
- Test in both light and dark themes where relevant.
- Desktop viewport (~1280px+), tablet (~768–1024px), and narrow mobile (~360–390px). Include 200% browser zoom / large text pass on key screens.
- Browsers: latest Chrome/Edge + Firefox + Safari where available.

## Screen readers (NVDA / VoiceOver / JAWS)

Run focused passes on each platform you have access to; record browser + AT + OS version.

| Surface | Checks |
| --- | --- |
| Global navigation / header | Marketing and app headers announce landmarks/nav, menu button state (`expanded/collapsed`), current page context where applicable. Mobile menu open/close announces state and focus moves into/out of menu predictably. |
| Global search (`Ctrl+K` / trigger) | Dialog announced with accessible name ("Search"). Search field has an announced label (not placeholder-only). Results/quick links read as actionable items; closing (Escape/selection) returns focus to a sensible control. |
| Sidebar quick find (dashboard) | Dialog announced ("Quick find"), input labelled, arrow-key active result changes are perceivable (selection/state announced), Enter activates, Escape closes and restores focus. Empty/error states ("No matches", "Player search failed…") announced. |
| Dialogs/modals (share, student/event/report/attendance/invite/import forms, confirmations) | `dialog` role/name announced from title, focus moves inside on open, focus trapped within while open, Escape/close dismisses and restores focus to invoker. Scrim is not announced as an extra control. |
| Drawers (analysis metadata, other side panels) | Announced as dialog with title, content reachable in order, close control named, focus restored on close. Closed drawer content must not be reachable. |
| Popovers/tooltips (click/hover info) | Trigger state (`expanded`/described-by) announced where implemented; content readable when shown; Escape dismisses click popovers and returns focus appropriately. |
| Dropdowns/selects/menus (9ui/Base UI controls) | Trigger has accessible name, current value/selection announced, options navigable with keyboard, collapsed/expanded state announced. |
| Analysis detail | Share link field labelled ("Share link"), read-only value announced, copy action discoverable. Findings timeline items announce category/time/severity/review state; approve/flag actions named and state changes/errors (`alert`) announced. Criteria/details sections have meaningful summaries. |
| Org tables/grids (students, attendance, schedule, reports, audit, members) | Table headers/row context announced, inline actions named, status pills convey text not color-only, empty/loading/error states announced. |
| Forms (auth-adjacent account/settings, org CRUD dialogs) | Every input/select/textarea has a programmatic label, required/invalid states announced, inline/server errors associated and announced (`alert`/live region where used). |
| Player hub / share views | Read-only surfaces expose headings, metrics, and media with text alternatives/labels; no unlabeled interactive controls. |
| Media/video | Player controls keyboard/screen-reader operable; important visual-only cues have text equivalents where available. |

## Keyboard-only (no mouse)

Verify Tab/Shift+Tab order, visible focus, Enter/Space activation, Escape dismissal, and no focus traps outside dialogs.

- **Global:** skip/focus lands on meaningful controls; `/` and `Ctrl+K` shortcuts behave (and do not steal focus while typing in inputs). Focus ring visible in light/dark.
- **Dialogs/drawers/lightbox:** initial focus inside, Tab cycles within, Escape closes, focus returns to opener. Modal close buttons reachable and named.
- **Menus/selects/combobox-like triggers:** open with Enter/Space/arrow as component supports, navigate options, select, close with Escape.
- **Custom widgets:** click-popover trigger operable by keyboard and closes with Escape; interior `Modal`/`Drawer`/`Lightbox` focus management (verified in jsdom where possible, confirm in browser).
- **Findings timeline:** each finding button focusable/activatable (seeks when enabled), Approve/Flag buttons reachable and disabled state clear while saving.
- **Schedule/attendance:** date navigation, event/cell actions, and any drag alternatives (if present) usable without pointer; mobile list view controls reachable.
- **Share flow:** open Share, reach read-only URL field and Copy action, retry/error states keyboard reachable.

## Touch targets and responsive layout

Check at ~360px, ~390px, ~768px, and with zoom/text scaling.

- Interactive controls comfortably tappable (target ~44x44 CSS px where feasible); icon-only buttons have adequate hit area (e.g. header/menu/close controls).
- No horizontal page overflow in primary flows: dashboard home, students/teams/members, student profile, attendance grid, schedule (month/week/list as applicable), reports, history/analysis detail, settings/account, share view, auth-adjacent entry points.
- Long identifiers/URLs (share links, job IDs, provenance, criteria text) wrap or scroll locally without breaking layout.
- Tables/grids remain usable on small screens (horizontal scroll container where intended, sticky columns not obscuring content, controls not clipped).
- Dialog/sheet content scrolls within viewport; actions remain reachable.
- Charts and media scale to container; no clipped legends/labels that hide essential information.

## Focus/announcement order spot checks

- After async actions (save, send, generate share link, load failures) focus moves to a logical target or an inline status/`alert` is announced.
- Route/page transitions expose a clear heading/title first.
- Dynamic count/badge changes (notifications, results) do not cause confusing focus jumps.

## Reporting

Log issues with: flow/surface, steps, viewport/zoom, browser/OS/AT, expected vs actual, screenshot/recording, and severity (blocker/serious/moderate/minor).
