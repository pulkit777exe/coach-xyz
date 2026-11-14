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
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(async () => {}) },
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('CopyButton', () => {
  test('announces copied state to assistive tech', async () => {
    vi.useFakeTimers()
    const { CopyButton } = await import('@/components/interior/copy-button')

    await act(async () => {
      root.render(<CopyButton value="https://example.com/share/abc" label="Copy link" />)
    })

    const button = container.querySelector('button') as HTMLButtonElement | null
    expect(button).not.toBeNull()
    expect(button?.textContent).toContain('Copy link')
    expect(container.textContent).not.toContain('Copied to clipboard')

    await act(async () => {
      button!.click()
      await Promise.resolve()
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/share/abc')
    expect(button?.textContent).toContain('Copied!')
    expect(container.textContent).toContain('Copied to clipboard')

    await act(async () => {
      vi.advanceTimersByTime(2100)
    })
    expect(button?.textContent).toContain('Copy link')
  })
})
