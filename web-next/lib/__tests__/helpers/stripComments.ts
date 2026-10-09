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
 * Writing this file is itself an instance of the hazard it describes: the first draft of
 * this docblock quoted a literal block-comment terminator in prose, which closed the comment
 * early and turned the rest of the paragraph into code that did not parse. The repo's ledger
 * records the hazard; documenting it reproduced it. Avoid writing the terminator itself.
 */
export const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
