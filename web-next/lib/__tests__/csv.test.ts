import { describe, expect, it } from 'vitest'
import { toCSVString, parseCSV } from '../csv'

describe('toCSVString', () => {
  it('joins plain values with commas and rows with newlines', () => {
    expect(
      toCSVString([
        ['Name', 'Team', 'Goals'],
        ['Al', 'T1', 3],
      ]),
    ).toBe('Name,Team,Goals\nAl,T1,3')
  })

  it('renders null and undefined fields as empty', () => {
    expect(toCSVString([[null, undefined, 0]])).toBe(',,0')
  })

  it('quotes fields containing commas', () => {
    expect(toCSVString([['a,b']])).toBe('"a,b"')
  })

  it('quotes fields with newlines and doubles embedded quotes', () => {
    expect(toCSVString([['say "hi"', 'line1\nline2']])).toBe('"say ""hi""","line1\nline2"')
  })

  it('prefixes formula-injection strings with a single quote', () => {
    expect(toCSVString([['=cmd()', '+SUM(A1)', '-2+3', '@import', '\tlead']])).toBe(
      "'=cmd(),'+SUM(A1),'-2+3,'@import,'\tlead",
    )
  })

  it('leaves numeric negatives and ordinary strings untouched', () => {
    expect(toCSVString([[-5, 'normal', "1'=preexisting"]])).toBe("-5,normal,1'=preexisting")
  })
})

describe('parseCSV', () => {
  it('splits rows by newline and cells by commas', () => {
    expect(parseCSV('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('parses quoted cells containing commas', () => {
    expect(parseCSV('Name,"Rivera, Alex",Team\nAl,"Lee, Sam",T1')).toEqual([
      ['Name', 'Rivera, Alex', 'Team'],
      ['Al', 'Lee, Sam', 'T1'],
    ])
  })

  it('unwraps doubled quotes inside quoted cells', () => {
    expect(parseCSV('"say ""hi"""')).toEqual([['say "hi"']])
  })

  it('keeps newlines that appear inside quoted cells', () => {
    expect(parseCSV('"line one\nline two",b')).toEqual([['line one\nline two', 'b']])
  })

  it('skips entirely blank lines', () => {
    expect(parseCSV('a,b\n\n\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('handles CRLF line endings', () => {
    expect(parseCSV('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('preserves empty cells but not trailing empty lines', () => {
    expect(parseCSV('a,,b\n')).toEqual([['a', '', 'b']])
  })

  it('round-trips with toCSVString for ordinary values', () => {
    const rows = [
      ['Name', 'Sport', 'Notes'],
      ['Al', 'Tennis', 'Note, with comma'],
    ]
    expect(parseCSV(toCSVString(rows))).toEqual(rows)
  })

  it('leaves formula-prefixed cells as-is on import (no defusing)', () => {
    expect(parseCSV('=SUM(A1),@import')).toEqual([['=SUM(A1)', '@import']])
  })
})
