import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { SentryProvider } from './sentry-provider'
import AuthHeader from '@/components/AuthHeader'
import SkipLink from '@/components/SkipLink'
import { PreferencesProvider } from '@/lib/preferences'
import { Toaster } from '@/components/9ui/ui/sonner'
import './globals.css'

export const metadata: Metadata = {
  title: 'CoachXYZ | AI Sports Form Analysis',
  description:
    'Upload training footage and get timestamped form scores, correction cues, and annotated video — in under 60 seconds.',
  openGraph: {
    title: 'CoachXYZ',
    description: 'AI-powered sports video analysis for coaches.',
    type: 'website',
  },
}

const inter = Inter({
  subsets: ['latin'],
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
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
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <PreferencesProvider>
            <SentryProvider>
              <AuthHeader />
              <SkipLink />
              <div className="root">{children}</div>
              <Toaster position="bottom-right" richColors />
            </SentryProvider>
          </PreferencesProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
