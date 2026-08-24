import type { Metadata } from 'next'
import { Inter, Source_Serif_4, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const sourceSerif = Source_Serif_4({ subsets: ['latin'], variable: '--font-serif', weight: ['500', '600'] })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', weight: ['400', '500', '600', '700'] })

export const metadata: Metadata = {
  title: 'Patrimonio Netto',
  description: 'Dashboard finanziaria personale',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${inter.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-surface-50 text-gray-900 antialiased">{children}</body>
    </html>
  )
}
