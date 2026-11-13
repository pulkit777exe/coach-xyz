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

describe('Modal', () => {
  test('renders a labelled dialog when open and closes on Escape and close button', async () => {
    const { Modal } = await import('@/components/interior/modal')
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <Modal open onClose={onClose} title="Share Analysis">
          <p>Body</p>
        </Modal>,
      )
    })

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement | null
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    const titleId = dialog?.getAttribute('aria-labelledby')
    expect(titleId).toBeTruthy()
    expect(document.getElementById(titleId!)?.textContent).toBe('Share Analysis')

    const closeBtn = document.body.querySelector('button[aria-label="Close dialog"]') as HTMLButtonElement | null
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
  })

  test('renders nothing when closed', async () => {
    const { Modal } = await import('@/components/interior/modal')
    await act(async () => {
      root.render(
        <Modal open={false} onClose={() => {}} title="Hidden">
          <p>Body</p>
        </Modal>,
      )
    })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
})
