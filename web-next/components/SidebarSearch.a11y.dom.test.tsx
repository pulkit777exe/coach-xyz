// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/lib/org/students', () => ({
  orgStudents: vi.fn(async () => ({ students: [] })),
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
})

const openPalette = async () => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  })
  await act(async () => { await Promise.resolve() })
}

describe('SidebarSearch a11y semantics', () => {
  test('exposes a listbox with selectable options and tracks the active descendant', async () => {
    const { default: SidebarSearch } = await import('@/components/SidebarSearch')

    await act(async () => {
      root.render(<SidebarSearch auth0Id="auth0|org" role="owner" />)
    })

    await openPalette()

    const input = document.body.querySelector('input[aria-label="Search pages and players"]') as HTMLInputElement | null
    const listbox = document.body.querySelector('[role="listbox"]') as HTMLElement | null
    expect(input).not.toBeNull()
    expect(listbox).not.toBeNull()

    const options = document.body.querySelectorAll('[role="option"]')
    expect(options.length).toBeGreaterThan(0)
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
    const activeId = options[0]?.querySelector('button')?.id
    expect(activeId).toBeTruthy()
    expect(input?.getAttribute('aria-activedescendant')).toBe(activeId)

    await act(async () => {
      document.body.querySelector('[role="dialog"]')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      )
    })
    const updated = document.body.querySelectorAll('[role="option"]')
    expect(updated[1]?.getAttribute('aria-selected')).toBe('true')
    const nextId = updated[1]?.querySelector('button')?.id
    expect(input?.getAttribute('aria-activedescendant')).toBe(nextId)
  })
})
