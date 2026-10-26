// Fixture for bespokeTypeSizes.test.ts — never imported, never rendered.
//
// It carries the shapes the guard's classifier must tell apart, and NOTHING else: a real
// module would import something and the file would stop being inert. Kept out of `app/` and
// `components/` deliberately, because the guard scans those two and a fixture sitting in
// either would be counted by the tree-wide assertion as a real site.
//
//   text-[26px]  bespoke-permitted under the current rule
//   text-[44px]  bespoke-permitted under the current rule
//   text-[12px]  one of the six, so a DIFFERENT rule owns it
//   text-[8px]   covered by NO rule: not one of the six, not bespoke (below the floor), and
//                not one of the named below-floor exceptions (9, 10). This is the positive
//                control — my first version used 12px, which is one of the six, so the
//                classifier correctly reported it as accounted for and the control passed for
//                the wrong reason. A positive control must be a value the assertion would
//                actually reject, not one it quietly tolerates.
export const BESPOKE = 'text-[26px] text-[44px] text-[12px] text-[8px]'
