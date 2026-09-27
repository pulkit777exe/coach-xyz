# Architecture decision records

Short, dated decisions with their reasoning and the alternatives that were
rejected. Each ADR is immutable once accepted; supersede it with a new file
rather than editing the old one.

| ADR                                           | Status   | Date       | Decision                                                        |
| --------------------------------------------- | -------- | ---------- | --------------------------------------------------------------- |
| [0001](adr-0001-deliberate-status-quo.md)     | Accepted | 2026-09-24 | Deliberate status quo                                           |
| [0002](adr-0002-roster-scope-two-tiers.md)    | Accepted | 2026-09-26 | Roster scope has two tiers, not one                             |
| [0003](adr-0003-authorization-four-layers.md) | Accepted | 2026-09-27 | Authorization is four layers; only the inner two say whose data |

## Reading order

- **New to authorization?** Read 0002 first (who may see _which players_), then
  0003 (how the four layers compose, and why a mount-time guard is not a
  capability).
- **Re-auditing a route?** 0003's decision section is the checklist. The traps
  it names — the org-keyed account tree, a UUID that is not a permission, a
  share token being a write — are the three that shipped as gaps.
- **Changing a decision?** Add a new ADR that supersedes it, and update the
  table above plus any `AGENTS.md` line that states the old rule.
