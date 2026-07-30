export function AppHeader() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--cream-05)] bg-[var(--bg)]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-12">
        <a href="/" className="font-serif text-xl text-[var(--fg)]">coach.xyz</a>
        <a href="/" className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--cream-40)] hover:text-[var(--fg)] transition-colors">New Analysis</a>
      </div>
    </header>
  )
}
