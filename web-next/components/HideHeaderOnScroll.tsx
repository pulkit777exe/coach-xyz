'use client'

import { useHideOnScroll } from "@/components/interior/hide-on-scroll"

export function HideHeaderOnScroll() {
  const { ref, hidden } = useHideOnScroll()

  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className={`fixed top-14 left-0 right-0 z-40 bg-(--bg)/90 backdrop-blur-md border-b border-(--cream-05) px-4 py-3 flex items-center justify-between transition-transform duration-300 md:hidden ${
        hidden ? '-translate-y-full' : 'translate-y-0'
      }`}
    >
      <span className="font-serif text-lg text-(--fg)">coach.xyz</span>
    </div>
  )
}
