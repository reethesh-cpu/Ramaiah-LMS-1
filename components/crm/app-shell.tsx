'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  BarChart3,
  BriefcaseBusiness,
  ClipboardCheck,
  Columns3,
  Files,
  FolderKanban,
  LayoutDashboard,
  Layers3,
  LogOut,
  Tags,
  Users,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { BrandLockup } from '@/components/brand-lockup'

type Profile = { full_name: string; email: string; role_code: string }

const adminLinks = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/workbooks', label: 'Workbooks', icon: FolderKanban },
  { href: '/admin/templates', label: 'Templates & headers', icon: Layers3 },
  { href: '/admin/user-columns', label: 'User columns', icon: Columns3 },
  { href: '/admin/categories', label: 'Categories', icon: Tags },
  { href: '/admin/users', label: 'People & access', icon: Users },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3 },
]

const workspaceLinks = [
  { href: '/workspace', label: 'My workspace', icon: ClipboardCheck },
]

function titleForPath(pathname: string, isAdmin: boolean) {
  if (!isAdmin) return 'My workspace'
  return adminLinks.find((item) => item.href === pathname)?.label ?? 'Workbook'
}

export function AppShell({ profile, isAdmin, children }: { profile: Profile; isAdmin: boolean; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const links = isAdmin ? adminLinks : workspaceLinks

  async function signOut() {
    setPending(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/sign-in')
    router.refresh()
  }

  const initials = profile.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  const roleLabel = profile.role_code.replaceAll('_', ' ')

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <BrandLockup href={isAdmin ? '/admin' : '/workspace'} label="Ramaiah Capital" />
        <div className="nav-label">Workspace</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {links.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`))
            return <Link className="sidebar-link" data-active={active} href={href} key={href} aria-current={active ? 'page' : undefined}><Icon aria-hidden="true" /><span>{label}</span></Link>
          })}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-profile">
          <span className="avatar-initial" aria-hidden="true">{initials || 'N'}</span>
          <div className="profile-copy"><div className="profile-name">{profile.full_name}</div><div className="profile-role">{roleLabel}</div></div>
          <button className="sidebar-logout" type="button" aria-label="Sign out" title="Sign out" disabled={pending} onClick={signOut}><LogOut size={16} /></button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div><div className="topbar-kicker">Ramaiah Capital</div><div className="topbar-title">{titleForPath(pathname, isAdmin)}</div></div>
          <div className="topbar-right"><BriefcaseBusiness size={15} /><span>{isAdmin ? 'Head office' : 'Team workspace'}</span></div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  )
}
