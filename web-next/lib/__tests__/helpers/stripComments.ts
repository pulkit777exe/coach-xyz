/**
 * Remove block and line comments from source, so a scanner matches CODE rather than prose.
 *
 * Extracted because two guards now need it and `typeScaleComponents.test.ts` had its own
 * copy. The repo's rule is one writer and one caller per path: six byte-identical `initials()`
 * copies survived precisely because nothing distinguishes a copy from the original until you
 * diff them, and `lib/isoTime.ts` exists because the same class was re-derived seven times.
 *
 * The `[^:]` before `//` is load-bearing and easy to lose: without it a URL in a comment —
 * or, more dangerously here, a comment that DOCUMENTS a class name like `text-[26px]` — is
 * left half-matched. `DESIGN_FOUNDATIONS.md` records that the only literal `text-[Npx]` left
 * in the repo are vendored files and **comment references**, so an unstripped scan counts
 * documentation as code, which is how a guard ends up asserting on its own author's notes.
 *
 * THE ORDER OF THE TWO PASSES IS LOAD-BLOCKING, and it was wrong until a consistency check
 * caught it. The first version ran the block pass before the line pass, so a block-comment
 * OPENER appearing inside a line comment — `// ... blocked from /api/org/` followed by an
 * asterisk — opened a PHANTOM block that ran until the next real closer, wherever that was.
 * On `SettingsClient.tsx` that closer was 90 lines away, and the helper silently deleted 134
 * real lines of `lib/org.ts`, 68 of that file and 37 of `lib/meApi.ts`, so four guards were
 * scanning truncated sources and reporting clean. Nothing was hidden in the deleted spans at
 * the time, which is exactly why it survived: the defect is only visible to a guard that
 * happens to need the span it deleted. Both comment forms are therefore matched in ONE
 * left-to-right pass, so a line comment consumes to end of line before any later opener on
 * that line can take effect.
 *
 * Writing this file is itself an instance of the hazard it describes: the first draft of
 * this docblock quoted a literal block-comment terminator in prose, which closed the comment
 * early and turned the rest of the paragraph into code that did not parse. The repo's ledger
 * records the hazard; documenting it reproduced it. Avoid writing the terminator itself.
 */
export const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/gm, (m, p1) => p1 ?? '')
