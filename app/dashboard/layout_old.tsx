'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useEffect, useState } from 'react'

const navItems = [
  { href: '/dashboard', label: 'Movimenti & Cash Flow', icon: '◈' },
  { href: '/dashboard/upload', label: 'Importa dati', icon: '↑' },
  { href: '/dashboard/profilo', label: 'Profilo', icon: '○' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [isAdmin, setIsAdmin] = useState(false)

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

  async function logout() {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-white border-r border-surface-200 flex flex-col fixed h-full">
        <div className="px-5 py-5 border-b border-surface-100">
          <p className="font-semibold text-gray-900 text-sm">Patrimonio Netto</p>
          <p className="text-xs text-gray-400 mt-0.5">2026</p>
        </div>

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
      </aside>

      <main className="flex-1 ml-56 p-6">
        {children}
      </main>
    </div>
  )
}
