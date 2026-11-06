import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import AuthHeader from '@/components/AuthHeader'
import SkipLink from '@/components/SkipLink'
import { PreferencesProvider } from '@/lib/preferences'
import { Toaster } from '@/components/9ui/ui/sonner'
import './globals.css'
import { Analytics } from '@vercel/analytics/next'


export const metadata: Metadata = {
  title: 'CoachXYZ | AI Sports Form Analysis',
  description:
    'Upload training footage and get timestamped, criterion-level feedback, correction cues, and annotated video.',
  openGraph: {
    title: 'CoachXYZ',
    description: 'AI-powered sports video analysis for coaches.',
    type: 'website',
  },
}

const inter = Inter({
  subsets: ['latin'],
  // Real italic face — the marketing blockquote renders italic; loading the
  // style keeps it from being browser-synthesized (better-typography).
  style: ['normal', 'italic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains',
  display: 'swap',
})

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // proxy.ts stamps every document request with a fresh CSP nonce. next-themes
  // renders its own inline pre-hydration script, so it needs the nonce too.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="min-h-screen antialiased bg-background text-foreground">
        <Analytics />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
          <PreferencesProvider>
            <AuthHeader />
            <SkipLink />
            <div className="root">{children}</div>
            <Toaster position="bottom-right" richColors />
          </PreferencesProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
