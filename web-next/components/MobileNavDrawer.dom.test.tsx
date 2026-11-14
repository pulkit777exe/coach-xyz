// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import MobileNavDrawer from './MobileNavDrawer'

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
  document.body.style.overflow = ''
  document.body.innerHTML = ''
})

function renderDrawer() {
  return act(async () => {
    root.render(
      <MobileNavDrawer label="Owner A" footer={<div>Footer</div>}>
        <a href="/dashboard">Dashboard</a>
      </MobileNavDrawer>,
    )
  })
}

describe('MobileNavDrawer', () => {
  test('closed state keeps dialog inert/hidden from tab order and exposes toggle state', async () => {
    await renderDrawer()
    const toggle = document.body.querySelector('button[aria-label="Open navigation"]') as HTMLButtonElement | null
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement | null
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBeNull()
    expect(dialog?.hasAttribute('inert')).toBe(true)
  })

  test('opens with focus inside, traps page behind via inert siblings, and closes/restores on Escape', async () => {
    await renderDrawer()
    const outside = document.createElement('button')
    outside.textContent = 'outside'
    document.body.appendChild(outside)
    const toggle = document.body.querySelector('button[aria-label="Open navigation"]') as HTMLButtonElement
    toggle.focus()

    await act(async () => { toggle.click() })

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement | null
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.hasAttribute('inert')).toBe(false)
    expect(dialog?.getAttribute('aria-label')).toBe('Owner A navigation')

    const closeBtn = document.body.querySelector('button[aria-label="Close navigation"]') as HTMLButtonElement | null
    expect(closeBtn).not.toBeNull()
    expect(document.activeElement).toBe(closeBtn)
    expect(document.body.style.overflow).toBe('hidden')
    expect(outside.hasAttribute('inert')).toBe(true)

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(dialog?.getAttribute('aria-modal')).toBeNull()
    expect(dialog?.hasAttribute('inert')).toBe(true)
    expect(document.activeElement).toBe(toggle)
    expect(outside.hasAttribute('inert')).toBe(false)
    expect(document.body.style.overflow).toBe('')
    outside.remove()
  })

  test('close button and backdrop click restore focus to toggle', async () => {
    await renderDrawer()
    const toggle = document.body.querySelector('button[aria-label="Open navigation"]') as HTMLButtonElement

    await act(async () => { toggle.click() })
    const closeBtn = document.body.querySelector('button[aria-label="Close navigation"]') as HTMLButtonElement
    await act(async () => { closeBtn.click() })
    expect(document.activeElement).toBe(toggle)

    await act(async () => { toggle.click() })
    const backdrop = Array.from(document.body.querySelectorAll('div[aria-hidden="true"]')).find(
      (el) => el.className.includes('bg-overlay'),
    ) as HTMLElement | undefined
    expect(backdrop).toBeTruthy()
    await act(async () => { backdrop!.click() })
    expect(document.activeElement).toBe(toggle)
  })

  test('link click closes drawer without forcing focus back to toggle', async () => {
    await renderDrawer()
    const outside = document.createElement('button')
    outside.textContent = 'outside'
    document.body.appendChild(outside)
    const toggle = document.body.querySelector('button[aria-label="Open navigation"]') as HTMLButtonElement
    toggle.focus()
    await act(async () => { toggle.click() })
    const link = document.body.querySelector('a[href="/dashboard"]') as HTMLAnchorElement
    expect(link).not.toBeNull()
    link.focus()
    await act(async () => { link.click() })
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement | null
    expect(dialog?.hasAttribute('inert')).toBe(true)
    // focus is not restored to toggle (navigation would move away); in jsdom it may remain on link
    expect(document.activeElement).not.toBe(toggle)
    outside.remove()
  })
})
