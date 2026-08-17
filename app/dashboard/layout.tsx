'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import NotificationBell from '@/components/NotificationBell'
import { AnnoProvider, useAnno } from '@/lib/AnnoContext'

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
      className="input w-20 text-sm py-1.5"
      aria-label="Anno selezionato"
    >
      {anniDisponibili.map(y => <option key={y}>{y}</option>)}
    </select>
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
        <div>
          <p className="font-semibold text-gray-900 text-sm">Patrimonio Netto</p>
        </div>
        <div className="flex items-center gap-2">
          <AnnoSelect />
          <NotificationBell />
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Apri menu"
            className="p-2 rounded-lg border border-surface-200 text-gray-600"
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
          <div>
            <p className="font-semibold text-gray-900 text-sm">Patrimonio Netto</p>
          </div>
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
      <aside className="hidden md:flex w-56 bg-white border-r border-surface-200 flex-col fixed h-full">
        <div className="px-5 py-5 border-b border-surface-100">
          <p className="font-semibold text-gray-900 text-sm">Patrimonio Netto</p>
        </div>
        {navLinks}
      </aside>

      <main className="flex-1 md:ml-56">
        {/* Header desktop */}
        <div className="hidden md:flex sticky top-0 z-20 items-center justify-end gap-3 bg-white border-b border-surface-200 px-6 py-3">
          <AnnoSelect />
          <NotificationBell />
        </div>
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
