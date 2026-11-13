// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, unoptimized: _u, ...rest } = props
    // eslint-disable-next-line @next/next/no-img-element -- test-only stand-in for next/image
    return <img alt="" {...rest} />
  },
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
  document.body.style.overflow = ''
  vi.resetModules()
})

describe('Lightbox', () => {
  test('open lightbox is labelled, traps focus target to close, and closes on Escape/button', async () => {
    const { Lightbox } = await import('@/components/interior/lightbox')
    const onClose = vi.fn()
    const trigger = document.createElement('button')
    trigger.textContent = 'Open'
    document.body.appendChild(trigger)
    trigger.focus()

    await act(async () => {
      root.render(<Lightbox open onClose={onClose} src="/frame.jpg" alt="Frame at release" />)
    })

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement | null
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    const titleId = dialog?.getAttribute('aria-labelledby')
    expect(document.getElementById(titleId!)?.textContent).toContain('Frame at release')

    const closeBtn = document.body.querySelector('button[aria-label="Close preview"]') as HTMLButtonElement | null
    expect(closeBtn).not.toBeNull()
    expect(document.activeElement).toBe(closeBtn)

    await act(async () => {
      closeBtn!.click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(2)

    await act(async () => {
      root.render(<Lightbox open={false} onClose={onClose} src="/frame.jpg" alt="Frame at release" />)
    })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
