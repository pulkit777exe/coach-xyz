// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

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

describe('Popover', () => {
  test('click trigger toggles dialog content, exposes aria state, and Escape closes with focus restored', async () => {
    const { Popover } = await import('@/components/interior/popover')

    await act(async () => {
      root.render(
        <Popover trigger="click" label="Helpful details" side="bottom">
          <span>Info</span>
        </Popover>,
      )
    })

    const trigger = document.body.querySelector('[role="button"]') as HTMLElement | null
    expect(trigger).not.toBeNull()
    expect(trigger?.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger?.getAttribute('aria-expanded')).toBe('false')
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => {
      trigger!.click()
    })

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement | null
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('Helpful details')
    expect(dialog?.getAttribute('aria-hidden')).toBe('false')
    expect(trigger?.getAttribute('aria-expanded')).toBe('true')
    const controls = trigger?.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    expect(dialog?.id).toBe(controls)

    await act(async () => {
      trigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect((document.body.querySelector('[role="dialog"]') as HTMLElement | null)?.getAttribute('aria-hidden')).toBe('true')
    expect(trigger?.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  test('hover trigger shows tooltip content and wires aria-describedby', async () => {
    const { Popover } = await import('@/components/interior/popover')

    await act(async () => {
      root.render(
        <Popover trigger="hover" label="Tip text">
          <span>Hover me</span>
        </Popover>,
      )
    })

    const rootEl = container.querySelector('span.relative.inline-flex') as HTMLElement | null
    expect(rootEl).not.toBeNull()
    const trigger = rootEl!.children[0] as HTMLElement | null
    expect(trigger).not.toBeNull()
    expect(trigger?.getAttribute('role')).toBeNull()

    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      trigger!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
      trigger!.focus()
    })
    await act(async () => { await Promise.resolve() })

    const tip = container.querySelector('[role="tooltip"]') as HTMLElement | null
    expect(tip).not.toBeNull()
    expect(tip?.textContent).toContain('Tip text')
    expect(tip?.getAttribute('aria-hidden')).toBe('false')
    expect(trigger?.getAttribute('aria-describedby')).toBe(tip?.id)

    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
      trigger!.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
      trigger!.blur()
    })
    expect((container.querySelector('[role="tooltip"]') as HTMLElement | null)?.getAttribute('aria-hidden')).toBe('true')
  })
})
