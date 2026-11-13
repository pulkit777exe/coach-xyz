// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))
vi.mock('@/lib/org/overview', () => ({
  orgSearch: vi.fn(async () => ({ students: [], schedule: [], reports: [], analyses: [] })),
}))

let container: HTMLDivElement
let root: Root
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.resetModules()
})

describe('GlobalSearch', () => {
  test('opens via Ctrl+K, shows labelled dialog/search input and quick links, closes on Escape', async () => {
    const { default: GlobalSearch } = await import('@/components/GlobalSearch')

    await act(async () => {
      root.render(<GlobalSearch sub="org|1" />)
    })

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    })

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement | null
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-label')).toBe('Search')
    const input = document.body.querySelector('input[aria-label="Search students, reports, analyses"]') as HTMLInputElement | null
    expect(input).not.toBeNull()
    expect(document.body.textContent).toContain('Quick links')
    expect(document.body.textContent).toContain('Dashboard')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    // Base UI dialog closes via escape; allow state flush
    await act(async () => { await Promise.resolve() })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
})
