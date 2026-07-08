import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Patrimonio Netto',
  description: 'Dashboard finanziaria personale',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={inter.variable}>
      <body className="bg-surface-50 text-gray-900 antialiased">{children}</body>
    </html>
  )
}
