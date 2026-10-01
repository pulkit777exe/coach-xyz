# CSV formula-defuse bypass via leading whitespace (unconfirmed)

Status: ready-for-agent

Triaged 2026-10-01: one-line guard change + test once a vulnerable consumer is confirmed.

## What

`server/src/lib/csv.ts` prefixes cells starting with `=+-@\t\r`.
A value like `" =cmd"` (leading space) may skip the guard while some
spreadsheet locales trim-then-evaluate. Unconfirmed: needs a check
against the actual consumer (Excel vs Sheets differ).

## Fix options

- Trim-then-test in the guard if the consumer evaluates that way.
- Confirm-then-close if Sheets/Excel both treat it as text.

## Context

Survey suspicion S1, 2026-09-30. Findings CSV is the highest-value
export path through this helper.
