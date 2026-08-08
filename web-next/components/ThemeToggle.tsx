'use client'

import { useTheme } from './ThemeProvider'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      className="relative flex h-9 w-16 items-center rounded-full border border-(--cream-10) bg-(--cream-05) p-1 transition-colors duration-500 hover:border-(--cream-20)"
    >
      <span
        className={`absolute h-7 w-7 rounded-full bg-(--fg) transition-all duration-500 ease-[cubic-bezier(0.68,-0.55,0.265,1.55)] ${
          theme === 'dark' ? 'left-0.5' : 'left-[calc(100%-2rem)]'
        }`}
      />
      <span className="relative z-10 flex h-7 w-7 items-center justify-center text-xs">
        {theme === 'dark' ? (
          <svg className="h-3.5 w-3.5 text-(--bg)" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5 text-(--bg)" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zm11.394-5.834a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591zM18 12a.75.75 0 01.75-.75H21a.75.75 0 010 1.5h-2.25A.75.75 0 0118 12zm-.303 5.243a.75.75 0 001.061-1.06l-1.59-1.591a.75.75 0 00-1.06 1.061l1.59 1.59z" />
          </svg>
        )}
      </span>
    </button>
  )
}
