'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import NotificationBell from '@/components/NotificationBell'
import SnapshotReminder from '@/components/SnapshotReminder'
import ContactModal from '@/components/ContactModal'
import { AnnoProvider, useAnno } from '@/lib/AnnoContext'

export const APP_NAME = 'Nucleo Finanza Personale'

const navItems = [
  { href: '/dashboard', label: 'Patrimonio', icon: '◆' },
  { href: '/dashboard/gestione', label: 'Gestione', icon: '◈' },
  { href: '/dashboard/upload', label: 'Importa dati', icon: '↑' },
  { href: '/dashboard/profilo', label: 'Profilo', icon: '○' },
]

function AnnoSelect() {
  const { anno, setAnno, anniDisponibili } = useAnno()
  return (
    <select
      value={anno}
      onChange={e => setAnno(Number(e.target.value))}
      className="h-9 w-[86px] border border-surface-200 rounded-lg pl-2 pr-1 text-sm bg-white
                 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
      aria-label="Anno selezionato"
    >
      {anniDisponibili.map(y => <option key={y}>{y}</option>)}
    </select>
  )
}

function SyncButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  return (
    <button
      onClick={() => router.push('/dashboard/upload?autosync=1')}
      title="Sincronizza dati da Google Sheets"
      className={`h-9 flex items-center justify-center gap-1.5 rounded-lg bg-green-600 text-white font-medium
                  hover:bg-green-700 transition-colors shadow-sm
                  ${compact ? 'w-9' : 'w-full px-3 text-sm'}`}
    >
      <span className="text-base leading-none">⟳</span>
      {!compact && 'Sincronizza'}
    </button>
  )
}

function SidebarFooterNote() {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="px-4 py-3 border-t border-surface-100 space-y-2.5">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left flex items-start justify-between gap-2 group"
      >
        <p className="text-[11px] leading-snug text-gray-500 group-hover:text-gray-700">
          {expanded
            ? `${APP_NAME} è un cruscotto personale per monitorare flussi di cassa, patrimonio netto, portafoglio investimenti e alert di accumulo, sincronizzato dai tuoi Google Sheets. È uno strumento di solo monitoraggio: non fornisce consulenza finanziaria, fiscale o di investimento — le decisioni restano sempre tue.`
            : 'Solo monitoraggio personale — nessun consiglio finanziario, fiscale o di investimento.'}
        </p>
        <span className={`shrink-0 text-gray-300 text-[10px] transition-transform mt-0.5 ${expanded ? 'rotate-180' : ''}`}>▾</span>
      </button>
      <ContactModal />
    </div>
  )
}

function Logo({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`shrink-0 rounded-lg bg-brand-600 text-white flex items-center justify-center font-bold
                        ${size === 'sm' ? 'w-7 h-7 text-xs' : 'w-8 h-8 text-sm'}`}>
        N
      </span>
      <p className={`num-display font-semibold text-gray-900 leading-tight ${size === 'sm' ? 'text-sm' : 'text-[15px]'}`}>
        {APP_NAME}
      </p>
    </div>
  )
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [isAdmin, setIsAdmin] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    async function checkAdmin() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('profili')
        .select('is_admin')
        .eq('user_id', user.id)
        .single()
      setIsAdmin(data?.is_admin ?? false)
    }
    checkAdmin()
  }, [])

  // Close the mobile drawer whenever the route changes
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  async function logout() {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  const navLinks = (
    <>
      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors
              ${pathname === item.href
                ? 'bg-brand-50 text-brand-700 font-medium'
                : 'text-gray-600 hover:bg-surface-50 hover:text-gray-900'}`}
          >
            <span className="text-base">{item.icon}</span>
            {item.label}
          </Link>
        ))}

        {isAdmin && (
          <Link
            href="/dashboard/admin"
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mt-2
              ${pathname === '/dashboard/admin'
                ? 'bg-brand-50 text-brand-700 font-medium'
                : 'text-gray-600 hover:bg-surface-50 hover:text-gray-900'}`}
          >
            <span className="text-base">⚙</span>
            Admin
          </Link>
        )}
      </nav>

      <SidebarFooterNote />

      <div className="p-3 border-t border-surface-100">
        <button
          onClick={logout}
          className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:text-gray-600 rounded-lg hover:bg-surface-50"
        >
          Esci
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen md:flex">
      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between bg-white border-b border-surface-200 px-4 py-3">
        <Logo size="sm" />
        <div className="flex items-center gap-2">
          <AnnoSelect />
          <SyncButton compact />
          <SnapshotReminder compact />
          <NotificationBell />
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Apri menu"
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-surface-200 text-gray-600"
          >
            <span className="text-lg leading-none">☰</span>
          </button>
        </div>
      </div>

      {/* Mobile drawer overlay */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/30"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`md:hidden fixed top-0 left-0 h-full w-64 max-w-[80%] bg-white border-r border-surface-200 flex flex-col z-50
          transform transition-transform duration-200
          ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="px-5 py-5 border-b border-surface-100 flex items-center justify-between">
          <Logo size="sm" />
          <button
            onClick={() => setMenuOpen(false)}
            aria-label="Chiudi menu"
            className="p-1 text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
        {navLinks}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 bg-white border-r border-surface-200 flex-col fixed h-full">
        <div className="px-5 py-5 border-b border-surface-100 space-y-3">
          <Logo />
          <div className="flex items-center gap-2">
            <AnnoSelect />
            <NotificationBell />
          </div>
          <SyncButton />
          <SnapshotReminder />
        </div>
        {navLinks}
      </aside>

      <main className="flex-1 md:ml-60">
        <div className="p-4 md:p-6">
          {children}
        </div>
      </main>
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AnnoProvider>
      <DashboardShell>{children}</DashboardShell>
    </AnnoProvider>
  )
}
