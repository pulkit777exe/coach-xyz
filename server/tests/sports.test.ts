import { describe, expect, test } from 'bun:test'

import { cleanPositions } from '../src/routes/sports'

describe('cleanPositions', () => {
  test('keeps well-formed entries with trimmed ids and labels', () => {
    expect(
      cleanPositions([
        { id: ' point_guard ', label: ' Point Guard ', description: 'Runs the offense.' },
      ]),
    ).toEqual([{ id: 'point_guard', label: 'Point Guard', description: 'Runs the offense.' }])
  })

  test('drops malformed entries and defaults missing descriptions', () => {
    expect(
      cleanPositions([
        { id: '', label: 'Nope' },
        { id: 'x' },
        null,
        'point_guard',
        { id: 'center', label: 'Center' },
      ]),
    ).toEqual([{ id: 'center', label: 'Center', description: '' }])
  })

  test('non-arrays become empty lists', () => {
    expect(cleanPositions(null)).toEqual([])
    expect(cleanPositions({})).toEqual([])
    expect(cleanPositions('x')).toEqual([])
  })
})
