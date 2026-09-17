const FORMULA_CHARS = /^[=+\-@\t\r]/

function escapeCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ""
  const s = String(v)
  const safe = typeof v === "string" && FORMULA_CHARS.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Serializes rows to CSV text, quoting delimiters and defusing formula
 *  injection (cells starting with `=`, `+`, `-`, `@`, tab, or CR). */
export function toCSVString(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\n")
}

export function downloadCSV(filename: string, rows: (string | number | null)[][]) {
  const csv = toCSVString(rows)
  const url = window.URL.createObjectURL(
    new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" }),
  )
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  window.URL.revokeObjectURL(url)
}

/**
 * Parses CSV text into an array of cell rows. Follows the same escaping rules
 * as the export side (quoted fields, escaped `""` quotes, commas and newlines
 * inside quotes, CRLF/LF/CR record endings). Formula injection is defused ONLY
 * on export — import cells are handed back verbatim; the server owns validation.
 *
 * Entirely blank lines are skipped; cells otherwise keep their raw text,
 * including interior whitespace.
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false

  const pushRecord = () => {
    row.push(cell)
    const isBlank = row.every((c) => c === "")
    if (!isBlank) rows.push(row)
    row = []
    cell = ""
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      row.push(cell)
      cell = ""
    } else if (ch === "\n") {
      pushRecord()
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") {
        pushRecord()
        i++
      } else {
        pushRecord()
      }
    } else {
      cell += ch
    }
  }

  // Flush any trailing content without a final newline (skip dangling blanks).
  if (!(row.length === 0 && cell === "")) {
    row.push(cell)
    const isBlank = row.every((c) => c === "")
    if (!isBlank) rows.push(row)
  }

  return rows
}