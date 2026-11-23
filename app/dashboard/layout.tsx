'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useEffect, useState, type ReactElement } from 'react'
import NotificationBell from '@/components/NotificationBell'
import SnapshotReminder from '@/components/SnapshotReminder'
import ContactModal from '@/components/ContactModal'
import AnalisiFinanziariaModal from '@/components/analisi/AnalisiFinanziariaModal'
import { AnnoProvider, useAnno } from '@/lib/AnnoContext'
import {
  IconPatrimonio, IconGestione, IconFire, IconTrendDown, IconUpload, IconUser, IconShield,
  IconSync, IconLogout, IconMenu, IconClose, IconPanelLeft,
} from '@/components/ui/Icons'

export const APP_NAME = 'Nucleo Finanza Personale'

type NavItem = { href: string; label: string; Icon: (p: { size?: number; className?: string }) => ReactElement }

const navMain: NavItem[] = [
  { href: '/dashboard', label: 'Patrimonio', Icon: IconPatrimonio },
  { href: '/dashboard/gestione', label: 'Gestione', Icon: IconGestione },
  { href: '/dashboard/fire', label: 'FIRE', Icon: IconFire },
  { href: '/dashboard/speculativo', label: 'Short complementari', Icon: IconTrendDown },
]
const navSecondary: NavItem[] = [
  { href: '/dashboard/upload', label: 'Importa dati', Icon: IconUpload },
  { href: '/dashboard/profilo', label: 'Profilo', Icon: IconUser },
]
const navAdmin: NavItem = { href: '/dashboard/admin', label: 'Admin', Icon: IconShield }

const isActive = (pathname: string, href: string) =>
  href === '/dashboard' ? pathname === href : pathname.startsWith(href)

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

function SyncButton() {
  const router = useRouter()
  return (
    <button
      onClick={() => router.push('/dashboard/upload?autosync=1')}
      title="Sincronizza dati da Google Sheets"
      aria-label="Sincronizza"
      className="h-9 flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium
                 hover:bg-brand-700 active:scale-95 transition-all shadow-sm w-9 md:w-auto md:px-3"
    >
      <IconSync size={16} />
      <span className="hidden md:inline">Sincronizza</span>
    </button>
  )
}

function SidebarFooterNote() {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="px-4 py-3 border-t border-surface-100 space-y-2.5">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left group"
      >
        <p className="text-[11px] leading-snug text-gray-500 group-hover:text-gray-700">
          {expanded
            ? `${APP_NAME} è un cruscotto personale per monitorare flussi di cassa, patrimonio netto, portafoglio investimenti e alert di accumulo, sincronizzato dai tuoi Google Sheets. È uno strumento di solo monitoraggio: non fornisce consulenza finanziaria, fiscale o di investimento — le decisioni restano sempre tue.`
            : 'Solo monitoraggio personale — nessun consiglio finanziario, fiscale o di investimento.'}
        </p>
      </button>
      <ContactModal />
    </div>
  )
}

function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="shrink-0 w-9 h-9 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold text-sm">
        N
      </span>
      {!collapsed && (
        <p className="num-display font-semibold text-gray-900 leading-tight text-[15px]">{APP_NAME}</p>
      )}
    </div>
  )
}

function NavLink({
  item, active, collapsed, onNavigate,
}: { item: NavItem; active: boolean; collapsed: boolean; onNavigate?: () => void }) {
  const { Icon } = item
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={`relative flex items-center gap-3 rounded-lg text-sm transition-colors
        ${collapsed ? 'justify-center h-10 w-10 mx-auto' : 'px-3 py-2.5'}
        ${active
          ? 'bg-brand-50 text-brand-700 font-semibold'
          : 'text-gray-600 hover:bg-surface-50 hover:text-gray-900'}`}
    >
      {active && !collapsed && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-brand-600" />}
      <Icon size={20} className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  )
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [isAdmin, setIsAdmin] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

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

  // Preferenza sidebar compatta (solo icone), ricordata nel browser
  useEffect(() => {
    try { setCollapsed(localStorage.getItem('sidebar-collapsed') === '1') } catch { /* ignore */ }
  }, [])
  function toggleCollapsed() {
    setCollapsed(v => {
      const next = !v
      try { localStorage.setItem('sidebar-collapsed', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  // Chiude il menu mobile a ogni cambio pagina
  useEffect(() => { setMenuOpen(false) }, [pathname])

  async function logout() {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  const allItems = [...navMain, ...navSecondary, navAdmin]
  const titolo = allItems.find(i => isActive(pathname, i.href) && (i.href !== '/dashboard' || pathname === i.href))?.label ?? ''

  const renderNav = (isCollapsed: boolean, onNavigate?: () => void) => (
    <nav className={`flex-1 overflow-y-auto ${isCollapsed ? 'px-2 py-3' : 'p-3'}`}>
      <div className="space-y-1">
        {navMain.map(item => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} collapsed={isCollapsed} onNavigate={onNavigate} />
        ))}
      </div>
      <div className="my-3 border-t border-surface-100" />
      <div className="space-y-1">
        {navSecondary.map(item => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} collapsed={isCollapsed} onNavigate={onNavigate} />
        ))}
        {isAdmin && (
          <NavLink item={navAdmin} active={isActive(pathname, navAdmin.href)} collapsed={isCollapsed} onNavigate={onNavigate} />
        )}
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen lg:flex">
      {/* Overlay menu mobile */}
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/30 fade-in" onClick={() => setMenuOpen(false)} />
      )}

      {/* Menu mobile */}
      <aside
        className={`lg:hidden fixed top-0 left-0 h-full w-64 max-w-[80%] bg-white border-r border-surface-200 flex flex-col z-50
          transform transition-transform duration-200 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="px-4 h-14 border-b border-surface-200 flex items-center justify-between shrink-0">
          <Logo />
          <button onClick={() => setMenuOpen(false)} aria-label="Chiudi menu" className="p-1.5 text-gray-400 hover:text-gray-600">
            <IconClose size={18} />
          </button>
        </div>
        {renderNav(false, () => setMenuOpen(false))}
        <SidebarFooterNote />
        <div className="p-3 border-t border-surface-100">
          <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-500 hover:text-gray-800 rounded-lg hover:bg-surface-50">
            <IconLogout size={18} /> Esci
          </button>
        </div>
      </aside>

      {/* Sidebar desktop: solo navigazione */}
      <aside
        className={`hidden lg:flex flex-col fixed h-full bg-white border-r border-surface-200 z-40 transition-[width] duration-200
          ${collapsed ? 'w-[68px]' : 'w-60'}`}
      >
        <div className={`h-14 border-b border-surface-200 flex items-center shrink-0 ${collapsed ? 'justify-center' : 'px-4'}`}>
          <Logo collapsed={collapsed} />
        </div>
        {renderNav(collapsed)}
        {!collapsed && <SidebarFooterNote />}
        <div className={`border-t border-surface-100 p-2 flex ${collapsed ? 'flex-col items-center gap-1' : 'items-center justify-between'}`}>
          <button
            onClick={logout}
            title="Esci"
            className={`flex items-center gap-2 rounded-lg text-sm text-gray-500 hover:text-gray-800 hover:bg-surface-50
              ${collapsed ? 'h-10 w-10 justify-center' : 'px-3 py-2'}`}
          >
            <IconLogout size={18} />{!collapsed && 'Esci'}
          </button>
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Espandi menu' : 'Comprimi menu'}
            aria-label={collapsed ? 'Espandi menu' : 'Comprimi menu'}
            className="h-10 w-10 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-surface-50"
          >
            <IconPanelLeft size={18} />
          </button>
        </div>
      </aside>

      <div className={`flex-1 min-w-0 transition-[margin] duration-200 ${collapsed ? 'lg:ml-[68px]' : 'lg:ml-60'}`}>
        {/* Barra in alto: titolo pagina + strumenti globali */}
        <header className="sticky top-0 z-30 h-14 bg-white border-b border-surface-200">
          <div className="flex items-center gap-3 h-full px-4 md:px-6">
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="Apri menu"
              className="lg:hidden h-9 w-9 flex items-center justify-center rounded-lg border border-surface-200 bg-white text-gray-600"
            >
              <IconMenu size={18} />
            </button>
            <h1 className="hidden sm:block num-display text-lg font-semibold text-gray-900 truncate">{titolo}</h1>
            <div className="ml-auto flex items-center gap-2">
              <AnnoSelect />
              <SnapshotReminder compact />
              <NotificationBell />
              <AnalisiFinanziariaModal compact />
              <SyncButton />
            </div>
          </div>
        </header>

        <main className="p-4 md:p-6">{children}</main>
      </div>
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
