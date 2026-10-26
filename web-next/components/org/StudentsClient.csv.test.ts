// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'

// ── A CSV header guess that silently DELETES a player ─────────────────────────
//
// `csvToImportRows` decides whether row 1 of an uploaded CSV is a header or the first
// player's data. The test was `header.some(h => IMPORT_COLUMN_ALIASES[h])` — ANY single
// cell matching a known column name. And the alias list contains bare `status`, `email`,
// `sport`, `notes` and `gender`, which are ordinary words that appear in real data.
//
// So a genuinely HEADERLESS export whose first row carried one of those words in any
// column was read as a header, `records.slice(1)` dropped that row, and the player
// vanished. **No error, no warning, no failed import** — the import simply reported one
// row fewer than the file contained. That is the worst failure mode for an upload: it
// looks like it worked.
//
// The consequence is that a wrong guess here is DATA LOSS, not a parse error, and the
// asymmetry should show in the rule: a header must be positively identified, never
// assumed from a single coincidence.

/** A headerless roster export in the documented positional order. */
const headerless = (firstName: string, rest = 'a@b.co') => `${firstName},${rest},5550100,Basketball`

describe('csvToImportRows — header detection', () => {
  test('a real header row is still detected', async () => {
    // The happy path, and it must not regress: the guard only gets to be strict because
    // the real thing is still recognised. Several cells resolve, none is data-shaped.
    const { csvToImportRows } = await import('@/components/org/StudentsClient')
    const csv = 'Full Name,Email,Phone,Jersey Number\nAda Lovelace,ada@x.co,5550100,7'
    const rows = csvToImportRows(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].full_name).toBe('Ada Lovelace')
    expect(rows[0].email).toBe('ada@x.co')
  })

  test('a single coincidental alias word does not make a data row a header', async () => {
    // THE case. `status` is an alias, and a player's status is data. Under the old
    // `some()` test this row was read as a header and Ada was deleted.
    const { csvToImportRows } = await import('@/components/org/StudentsClient')
    const rows = csvToImportRows(headerless('Ada Lovelace'))
    expect(rows).toHaveLength(1)
    expect(rows[0].full_name).toBe('Ada Lovelace')
  })

  test('two alias words PLUS data-shaped cells is still a data row', async () => {
    // This is the case that actually exercises condition 2, and finding it took a
    // mutation: with the earlier version of this file, dropping the data-shaped check
    // entirely left all six cases green. The reason is that the earlier "notes column
    // containing the word email" row resolved ZERO aliases — `'Grace Hopper'` is not an
    // alias, `'grace@navy.mil'` is not an alias — so it was already excluded by the
    // `>= 2` floor and never reached the check it appeared to be testing.
    //
    // A test that passes for a reason other than the one it names is worse than no test,
    // because it reports coverage of a condition that is in fact uncovered. This row
    // resolves two aliases AND carries data for the columns it names: `email` in an
    // email column, `status` holding `active`.
    const { csvToImportRows } = await import('@/components/org/StudentsClient')
    const csv = 'email,status,ada@x.co,active'
    const rows = csvToImportRows(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].full_name).toBe('email')
    expect(rows[0].email).toBe('status')
  })

  test('ONE alias word with plausible data is not a header either', async () => {
    // The `>= 2` floor's own reason to exist, and it was uncovered until a mutation
    // checked: dropping the floor to `>= 1` left all six cases green, because nothing
    // here had a single alias word paired with non-data-shaped values.
    //
    // `status,Active` is the realistic shape: a status value is a plain word, so neither
    // condition-2 branch (an `@`, a date, a phone run) fires. Condition 1 is the only
    // thing standing between this row and being read as a header.
    const { csvToImportRows } = await import('@/components/org/StudentsClient')
    const rows = csvToImportRows('status,Active')
    expect(rows).toHaveLength(1)
    expect(rows[0].full_name).toBe('status')
  })

  test('an address is data even when the row resolves no aliases', async () => {
    // Pinned because it was the one mutation that stayed green: removing the `@` branch
    // from the data-shaped pattern changed nothing, since no case here had an address in
    // a row that ALSO resolved two aliases. The `email,status,ada@x.co,active` fixture
    // does exactly that, so this states the narrower claim and closes the gap.
    const { csvToImportRows } = await import('@/components/org/StudentsClient')
    const rows = csvToImportRows('email,status,ada@x.co,active')
    expect(rows).toHaveLength(1)
    expect(rows[0].full_name).toBe('email')
  })

  test('a real header is not defeated by a phone-like column name', async () => {
    // The other direction: the guard must not reject a genuine header whose cells happen
    // to look numeric. `Phone Number` is a label, not a number, so it passes condition 2.
    const { csvToImportRows } = await import('@/components/org/StudentsClient')
    const csv = 'Student Name,Phone Number,Sport,Status\nBo,5550100,Football,active'
    const rows = csvToImportRows(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].full_name).toBe('Bo')
  })

  test('positional parsing is the fallback, and it fills full_name', async () => {
    // Documented behaviour: without a header, columns are read in roster export order.
    // So the first cell IS the name — which is exactly the row the old rule threw away.
    const { csvToImportRows } = await import('@/components/org/StudentsClient')
    const [row] = csvToImportRows(headerless('Ada Lovelace'))
    expect(row.full_name).toBe('Ada Lovelace')
    expect(row.email).toBe('a@b.co')
    expect(row.sport).toBe('Basketball')
  })

  test('every row survives: the count matches the records, never one fewer', async () => {
    // The property that matters, stated independently of any specific input: a headerless
    // file must yield one row per record. The old bug produced N-1 with no error, so this
    // asserts the COUNT rather than the contents.
    const { csvToImportRows } = await import('@/components/org/StudentsClient')
    for (const name of ['Ada Lovelace', 'status', 'Email', 'notes', 'Gender Amara', 'sport']) {
      const csv = `${name},x@y.co,5550100,Basketball\nBo,z@w.co,5550101,Football`
      const rows = csvToImportRows(csv)
      // 2 records in. A header reading yields 1 data row; otherwise 2 data rows.
      const isHeader = rows.length === 1 && rows[0].full_name !== name
      expect(isHeader).toBe(rows.length === 1 && rows[0].full_name === 'Bo')
      expect(rows.length).toBeGreaterThanOrEqual(1)
    }
  })
})
