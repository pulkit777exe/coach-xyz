// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
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

describe('HeaderClient marketing nav', () => {
  test('mobile menu toggles aria state, links controls, and closes/restores on Escape', async () => {
    const { default: HeaderClient } = await import('./HeaderClient')
    await act(async () => { root.render(<HeaderClient user={null} />) })

    const toggle = document.body.querySelector('button[aria-label="Open menu"]') as HTMLButtonElement | null
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(toggle?.getAttribute('aria-controls')).toBe('marketing-mobile-menu')

    toggle!.focus()
    await act(async () => { toggle!.click() })
    const closeToggle = document.body.querySelector('button[aria-label="Close menu"]') as HTMLButtonElement | null
    expect(closeToggle?.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById('marketing-mobile-menu')).not.toBeNull()

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    const reopened = document.body.querySelector('button[aria-label="Open menu"]') as HTMLButtonElement | null
    expect(reopened?.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(reopened)
  })

  test('desktop nav group exposes menu semantics and Escape returns focus to toggle', async () => {
    const { default: HeaderClient } = await import('./HeaderClient')
    await act(async () => { root.render(<HeaderClient user={null} />) })

    const groupToggle = Array.from(document.body.querySelectorAll('button[aria-haspopup="menu"]')).find(
      (b) => b.textContent?.includes('Product'),
    ) as HTMLButtonElement | undefined
    expect(groupToggle).toBeTruthy()
    expect(groupToggle!.getAttribute('aria-expanded')).toBe('false')

    groupToggle!.focus()
    await act(async () => { groupToggle!.click() })
    expect(groupToggle!.getAttribute('aria-expanded')).toBe('true')
    const menu = document.body.querySelector('[role="menu"]') as HTMLElement | null
    expect(menu).not.toBeNull()
    const items = Array.from(document.body.querySelectorAll('[role="menuitem"]'))
    expect(items.length).toBeGreaterThan(0)

    // Escape from inside menu restores focus to toggle
    ;(items[0] as HTMLElement).focus()
    await act(async () => {
      items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(groupToggle!.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(groupToggle)
  })
})
