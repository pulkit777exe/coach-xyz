// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
  document.body.style.overflow = ''
})

describe('Drawer', () => {
  test('open drawer is labelled, focusable, closes on Escape and button, and restores focus', async () => {
    const { Drawer } = await import('@/components/interior/drawer')
    const onOpenChange = vi.fn()
    const trigger = document.createElement('button')
    trigger.textContent = 'Open'
    document.body.appendChild(trigger)
    trigger.focus()

    await act(async () => {
      root.render(
        <Drawer open onOpenChange={onOpenChange} title="Analysis Metadata">
          <p>Body</p>
        </Drawer>,
      )
    })

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement | null
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.hasAttribute('inert')).toBe(false)
    const titleId = dialog?.getAttribute('aria-labelledby')
    expect(document.getElementById(titleId!)?.textContent).toBe('Analysis Metadata')

    const closeBtn = document.body.querySelector('button[aria-label="Close drawer"]') as HTMLButtonElement | null
    expect(closeBtn).not.toBeNull()
    expect(document.activeElement).toBe(closeBtn)

    await act(async () => {
      closeBtn!.click()
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)

    await act(async () => {
      root.render(
        <Drawer open={false} onOpenChange={onOpenChange} title="Analysis Metadata">
          <p>Body</p>
        </Drawer>,
      )
    })
    const closedDialog = document.body.querySelector('[role="dialog"]') as HTMLElement | null
    expect(closedDialog?.getAttribute('aria-modal')).toBeNull()
    expect(closedDialog?.hasAttribute('inert')).toBe(true)
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
