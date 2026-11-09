'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { ArrowRight, Check, FileSpreadsheet, FolderKanban, LoaderCircle, Search, Send, UsersRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type WorkbookRef = { id: string; name: string; status: string; template_id: string }
type Assignment = { id: string; lead_id: string; assigned_to: string; role_code: string; status: 'assigned' | 'completed'; lead_records: { id: string; workbook_id: string; workbooks: WorkbookRef } }
type Person = { id: string; full_name: string; role_code: string; manager_id: string | null }
type ListData = { userId: string; profile: Person; roles: Array<{ role_code: string; label: string }>; templates: Array<{ id: string; name: string }>; assignments: Assignment[] }
const supabase = createClient()

async function loadList(): Promise<ListData> {
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Sign in again to load your workbooks.')
  const [profileResult, rolesResult, templatesResult, assignmentResult] = await Promise.all([
    supabase.from('profiles').select('id,full_name,role_code,manager_id').eq('id', user.id).single(),
    supabase.from('role_definitions').select('role_code,label'),
    supabase.from('templates').select('id,name'),
    supabase.from('lead_assignments').select('id,lead_id,assigned_to,role_code,status,lead_records!inner(id,workbook_id,workbooks!inner(id,name,status,template_id))').order('assigned_at', { ascending: false }).range(0, 19999),
  ])
  if (profileResult.error || !profileResult.data || rolesResult.error || templatesResult.error || assignmentResult.error) throw new Error('Your workbooks could not be loaded.')
  return {
    userId: user.id,
    profile: profileResult.data as Person,
    roles: rolesResult.data ?? [],
    templates: (templatesResult.data ?? []) as Array<{ id: string; name: string }>,
    assignments: (assignmentResult.data ?? []) as unknown as Assignment[],
  }
}

type WorkbookGroup = { workbook: WorkbookRef; leadIds: Set<string>; myOpen: number; myCompleted: number; team: Set<string>; roles: Set<string> }

export default function WorkspacePage() {
  const { data, error, isLoading } = useSWR('team-workbook-list', loadList)
  const [search, setSearch] = useState('')
  const roleLabels = useMemo(() => new Map((data?.roles ?? []).map((role) => [role.role_code, role.label])), [data?.roles])
  const templateNames = useMemo(() => new Map((data?.templates ?? []).map((template) => [template.id, template.name])), [data?.templates])

  const workbookGroups = useMemo(() => {
    const map = new Map<string, WorkbookGroup>()
    for (const assignment of data?.assignments ?? []) {
      const workbook = assignment.lead_records?.workbooks
      if (!workbook?.id) continue
      let group = map.get(workbook.id)
      if (!group) {
        group = { workbook, leadIds: new Set(), myOpen: 0, myCompleted: 0, team: new Set(), roles: new Set() }
        map.set(workbook.id, group)
      }
      group.leadIds.add(assignment.lead_id)
      group.team.add(assignment.assigned_to)
      group.roles.add(assignment.role_code)
      if (assignment.assigned_to === data?.userId) {
        if (assignment.status === 'assigned') group.myOpen += 1
        else group.myCompleted += 1
      }
    }
    return [...map.values()].sort((a, b) => a.workbook.name.localeCompare(b.workbook.name))
  }, [data?.assignments, data?.userId])

  const visibleGroups = workbookGroups.filter((group) => `${group.workbook.name} ${templateNames.get(group.workbook.template_id) ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  const totalLeads = workbookGroups.reduce((total, group) => total + group.leadIds.size, 0)
  const myOpen = workbookGroups.reduce((total, group) => total + group.myOpen, 0)
  const myCompleted = workbookGroups.reduce((total, group) => total + group.myCompleted, 0)

  if (isLoading) return <div className="empty-state"><LoaderCircle className="animate-spin" /></div>
  if (error || !data) return <div className="notice" data-tone="error" role="alert">{error?.message ?? 'Your workbooks could not be loaded.'}</div>

  return <>
    <div className="page-heading"><div><div className="kicker">Team workspace · {roleLabels.get(data.profile.role_code) ?? data.profile.role_code}</div><h1>My workbooks</h1><p>Open a workbook to see its leads, fill your columns, and submit completed work.</p></div></div>
    <section className="stat-grid stat-grid-compact"><article className="card stat-card"><div className="stat-top">Workbooks<span className="stat-icon"><FolderKanban /></span></div><div className="stat-value">{workbookGroups.length}</div><div className="form-hint">Assigned to you or your team</div></article><article className="card stat-card"><div className="stat-top">Visible leads<span className="stat-icon"><UsersRound /></span></div><div className="stat-value">{totalLeads}</div><div className="form-hint">Across all your workbooks</div></article><article className="card stat-card"><div className="stat-top">My open work<span className="stat-icon"><Send /></span></div><div className="stat-value">{myOpen}</div><div className="form-hint">Assigned directly to you</div></article><article className="card stat-card"><div className="stat-top">My completed<span className="stat-icon"><Check /></span></div><div className="stat-value">{myCompleted}</div><div className="form-hint">Submitted by you</div></article></section>
    <section className="card section-card" style={{ marginTop: 0 }}>
      <div className="toolbar-row"><div><h2 style={{ margin: 0 }}>Assigned workbooks</h2><span className="form-hint">Each workbook keeps its own columns, so templates never mix.</span></div><div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 11, top: 10, color: '#8a8083' }} /><input className="toolbar-search" style={{ paddingLeft: 34 }} aria-label="Search workbooks" placeholder="Search workbooks" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div>
      {!workbookGroups.length ? <div className="empty-state"><span className="empty-icon"><FileSpreadsheet /></span><h3>No workbooks assigned yet</h3><p>When a workbook is assigned to you or your reporting line, it will appear here with an Open button.</p></div> : !visibleGroups.length ? <div className="empty-state"><h3>No matching workbooks</h3><p>Try a different search term.</p></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Workbook</th><th>Status</th><th>Visible leads</th><th>My open</th><th>My completed</th><th>Team</th><th>Action</th></tr></thead><tbody>{visibleGroups.map((group) => <tr key={group.workbook.id}><td><strong style={{ display: 'block', minWidth: 180 }}>{group.workbook.name}</strong><span className="form-hint">{templateNames.get(group.workbook.template_id) ?? 'Workbook template'}</span></td><td><span className="status-pill" data-tone={group.workbook.status === 'closed' ? 'neutral' : group.workbook.status === 'ongoing' ? 'amber' : undefined}><span className="status-dot" />{group.workbook.status}</span></td><td>{group.leadIds.size}</td><td>{group.myOpen}</td><td>{group.myCompleted}</td><td style={{ whiteSpace: 'normal', maxWidth: 220 }}>{[...group.roles].map((role) => roleLabels.get(role) ?? role).join(', ')}<span className="form-hint" style={{ display: 'block' }}>{group.team.size} {group.team.size === 1 ? 'person' : 'people'}</span></td><td><Link className="primary-button" href={`/workspace/${group.workbook.id}`}><ArrowRight /> Open</Link></td></tr>)}</tbody></table></div>}
    </section>
    {data.profile.manager_id && <div className="notice"><Check /> Work you update is shared with your reporting line. Uploaded source data stays read-only.</div>}
  </>
}
