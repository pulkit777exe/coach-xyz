import { describe, expect, it } from 'vitest'

import { addCalendarMonths, firstOfMonth, monthLabelFor } from '../useMonthNavigator'

describe('month arithmetic', () => {
  it('resolves the first of the containing month', () => {
    expect(firstOfMonth(new Date(2026, 9, 13))).toEqual(new Date(2026, 9, 1))
  })

  it('shifts months across year boundaries', () => {
    expect(addCalendarMonths(new Date(2026, 0, 1), -1)).toEqual(new Date(2025, 11, 1))
    expect(addCalendarMonths(new Date(2026, 11, 1), 2)).toEqual(new Date(2027, 1, 1))
  })

  it('labels months for the navigator header', () => {
    expect(monthLabelFor(new Date(2026, 9, 1))).toBe('October 2026')
  })
})
