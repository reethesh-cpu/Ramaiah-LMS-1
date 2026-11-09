'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import * as XLSX from 'xlsx'
import { Check, FileSpreadsheet, LoaderCircle, Search, Send, UsersRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Field = { id: string; template_id: string; field_key: string; label: string; field_kind: 'source' | 'user'; owner_role_code: string | null; owner_profile_id: string | null; input_type: string; options: string[]; is_required: boolean; sort_order: number }
type Assignment = { id: string; lead_id: string; assigned_to: string; role_code: string; status: 'assigned' | 'completed'; assigned_at: string; completed_at: string | null; lead_records: { id: string; row_number: number; source_values: Record<string, string | number | boolean | null>; workbooks: { id: string; name: string; status: string; template_id: string } }; assignment_field_values: Array<{ field_id: string; value: unknown; updated_at: string }> }
type Person = { id: string; full_name: string; role_code: string; manager_id: string | null }
type QueueData = { userId: string; profile: Person; roles: Array<{ role_code: string; label: string }>; people: Person[]; fields: Field[]; assignments: Assignment[] }
type LeadGroup = { lead: Assignment['lead_records']; workbook: Assignment['lead_records']['workbooks']; assignments: Assignment[] }
const supabase = createClient()

async function loadFields() {
  const full = await supabase.from('template_fields').select('id,template_id,field_key,label,field_kind,owner_role_code,owner_profile_id,input_type,options,is_required,sort_order').order('sort_order')
  if (!full.error) return full
  return supabase.from('template_fields').select('id,template_id,field_key,label,field_kind,owner_role_code,input_type,options,is_required,sort_order').order('sort_order')
}

async function loadQueue(): Promise<QueueData> {
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Sign in again to load your assigned work.')
  const [profileResult, rolesResult, peopleResult, fieldsResult, assignmentResult] = await Promise.all([
    supabase.from('profiles').select('id,full_name,role_code,manager_id').eq('id', user.id).single(),
    supabase.from('role_definitions').select('role_code,label'),
    supabase.from('profiles').select('id,full_name,role_code,manager_id'),
    loadFields(),
    supabase.from('lead_assignments').select('id,lead_id,assigned_to,role_code,status,assigned_at,completed_at,lead_records!inner(id,row_number,source_values,workbooks!inner(id,name,status,template_id)),assignment_field_values(field_id,value,updated_at)').order('assigned_at', { ascending: false }).range(0, 19999),
  ])
  if (profileResult.error || !profileResult.data || rolesResult.error || peopleResult.error || fieldsResult.error || assignmentResult.error) throw new Error('Your work queue could not be loaded.')
  return { userId: user.id, profile: profileResult.data as Person, roles: rolesResult.data ?? [], people: (peopleResult.data ?? []) as Person[], fields: (fieldsResult.data ?? []) as Field[], assignments: (assignmentResult.data ?? []) as unknown as Assignment[] }
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export default function WorkspacePage() {
  const { data, error, isLoading, mutate } = useSWR('team-work-queue', loadQueue)
  const [filter, setFilter] = useState<'open' | 'completed' | 'all'>('open')
  const [search, setSearch] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')
  const roleLabels = useMemo(() => new Map((data?.roles ?? []).map((role) => [role.role_code, role.label])), [data?.roles])
  const groups = useMemo(() => {
    const map = new Map<string, LeadGroup>()
    for (const assignment of data?.assignments ?? []) {
      const lead = assignment.lead_records
      if (!lead?.id || !lead.workbooks?.id) continue
      const existing = map.get(lead.id)
      if (existing) existing.assignments.push(assignment)
      else map.set(lead.id, { lead, workbook: lead.workbooks, assignments: [assignment] })
    }
    return [...map.values()]
  }, [data?.assignments])
  const visibleGroups = useMemo(() => groups.filter((group) => {
    const hasOpen = group.assignments.some((assignment) => assignment.status === 'assigned')
    const hasCompleted = group.assignments.some((assignment) => assignment.status === 'completed')
    const matchesFilter = filter === 'all' || (filter === 'open' ? hasOpen : hasCompleted && !hasOpen)
    const matchesSearch = `${group.workbook.name} ${Object.values(group.lead.source_values).join(' ')}`.toLowerCase().includes(search.toLowerCase())
    return matchesFilter && matchesSearch
  }), [groups, filter, search])
  const templateIds = new Set(visibleGroups.map((group) => group.workbook.template_id))
  const sourceFields = (data?.fields ?? []).filter((field) => field.field_kind === 'source' && templateIds.has(field.template_id))
  const visibleRoleCodes = new Set((data?.assignments ?? []).map((assignment) => assignment.role_code))
  if (data) visibleRoleCodes.add(data.profile.role_code)
  const visibleAssigneeIds = new Set((data?.assignments ?? []).map((assignment) => assignment.assigned_to))
  if (data) visibleAssigneeIds.add(data.userId)
  const userFields = (data?.fields ?? []).filter((field) => field.field_kind === 'user' && templateIds.has(field.template_id) && (
    field.owner_profile_id ? visibleAssigneeIds.has(field.owner_profile_id) : Boolean(field.owner_role_code && visibleRoleCodes.has(field.owner_role_code))
  ))

  function ownerLabelFor(field: Field) {
    if (field.owner_profile_id) return data?.people.find((person) => person.id === field.owner_profile_id)?.full_name ?? 'Team member'
    return roleLabels.get(field.owner_role_code ?? '') ?? field.owner_role_code ?? 'Team'
  }
  const ownOpenAssignments = data?.assignments.filter((assignment) => assignment.assigned_to === data.userId && assignment.status === 'assigned').length ?? 0
  const completedCount = data?.assignments.filter((assignment) => assignment.assigned_to === data.userId && assignment.status === 'completed').length ?? 0

  async function saveField(assignment: Assignment, field: Field, value: string) {
    const key = `${assignment.id}:${field.id}`
    setBusy(key); setFormError('')
    const { error: saveError } = await supabase.from('assignment_field_values').upsert({ assignment_id: assignment.id, field_id: field.id, value: value === '' ? null : value, updated_by: data?.userId }, { onConflict: 'assignment_id,field_id' })
    if (saveError) setFormError('This field could not be saved. Only the assigned user can edit their role fields.')
    else { setNotice('Update saved. Changes are visible to your reporting line.'); await mutate() }
    setBusy('')
  }

  async function completeAssignment(assignment: Assignment) {
    setBusy(assignment.id); setFormError(''); setNotice('')
    const { error: completeError } = await supabase.rpc('complete_assignment', { target_assignment_id: assignment.id })
    if (completeError) setFormError(completeError.message.includes('required') ? completeError.message : 'Assignment could not be completed. Review required fields and try again.')
    else { setNotice('Lead marked complete and sent to your reporting line.'); await mutate() }
    setBusy('')
  }

  function downloadQueue() {
    if (!data) return
    const rows = visibleGroups.map((group) => {
      const row: Record<string, unknown> = { Workbook: group.workbook.name, 'Lead row': group.lead.row_number, ...group.lead.source_values }
      for (const field of userFields.filter((item) => item.template_id === group.workbook.template_id)) {
        const assignment = field.owner_profile_id
          ? group.assignments.find((item) => item.assigned_to === field.owner_profile_id)
          : group.assignments.find((item) => item.role_code === field.owner_role_code && item.assignment_field_values?.some((value) => value.field_id === field.id)) ?? group.assignments.find((item) => item.role_code === field.owner_role_code)
        row[`${ownerLabelFor(field)} · ${field.label}`] = assignment?.assignment_field_values.find((value) => value.field_id === field.id)?.value ?? ''
      }
      row['Assigned team'] = group.assignments.map((assignment) => `${data.people.find((person) => person.id === assignment.assigned_to)?.full_name ?? 'Team member'} (${roleLabels.get(assignment.role_code) ?? assignment.role_code})`).join(', ')
      row['Work status'] = group.assignments.map((assignment) => `${roleLabels.get(assignment.role_code) ?? assignment.role_code}: ${assignment.status}`).join(', ')
      return row
    })
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Work queue')
    XLSX.writeFile(book, 'ramaiah-capital-work-queue.xlsx')
  }

  if (isLoading) return <div className="empty-state"><LoaderCircle className="animate-spin" /></div>
  if (error || !data) return <div className="notice" data-tone="error" role="alert">{error?.message ?? 'Work queue could not be loaded.'}</div>

  return <>
    <div className="page-heading"><div><div className="kicker">Team workspace · {roleLabels.get(data.profile.role_code) ?? data.profile.role_code}</div><h1>My work</h1><p>Review assigned leads, update your role fields, and submit completed work.</p></div><button className="secondary-button" onClick={downloadQueue}><FileSpreadsheet /> Export view</button></div>
    {(notice || formError) && <div className="notice" data-tone={formError ? 'error' : undefined} role={formError ? 'alert' : 'status'}>{formError || notice}</div>}
    <section className="stat-grid stat-grid-compact"><article className="card stat-card"><div className="stat-top">Open assignments<span className="stat-icon"><Send /></span></div><div className="stat-value">{ownOpenAssignments}</div><div className="form-hint">Assigned directly to you</div></article><article className="card stat-card"><div className="stat-top">Completed<span className="stat-icon"><Check /></span></div><div className="stat-value">{completedCount}</div><div className="form-hint">Submitted by you</div></article><article className="card stat-card"><div className="stat-top">Visible leads<span className="stat-icon"><UsersRound /></span></div><div className="stat-value">{groups.length}</div><div className="form-hint">Includes reports in your team tree</div></article></section>
    <section className="card section-card"><div className="toolbar-row"><div className="segmented" aria-label="Filter assigned work">{([['open', 'Open'], ['completed', 'Completed'], ['all', 'All visible']] as const).map(([value, label]) => <button key={value} type="button" data-active={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 11, top: 10, color: '#8a8083' }} /><input className="toolbar-search" style={{ paddingLeft: 34 }} aria-label="Search assigned leads" placeholder="Search workbook or lead" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div>
      {!visibleGroups.length ? <div className="empty-state"><span className="empty-icon"><FileSpreadsheet /></span><h3>{groups.length ? 'No matching work right now' : 'Nothing assigned yet'}</h3><p>{groups.length ? 'Try a different status filter or search term.' : 'When work is assigned to you or your reporting line, it will appear here.'}</p></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Workbook / lead</th>{sourceFields.map((field) => <th key={field.id}>{field.label}</th>)}{userFields.map((field) => <th key={field.id}>{ownerLabelFor(field)} · {field.label}</th>)}<th>Team status</th><th>Action</th></tr></thead><tbody>{visibleGroups.map((group) => { const currentAssignment = group.assignments.find((assignment) => assignment.assigned_to === data.userId && assignment.status === 'assigned'); const leadFields = sourceFields.filter((field) => field.template_id === group.workbook.template_id); const rowUserFields = userFields.filter((field) => field.template_id === group.workbook.template_id); return <tr key={group.lead.id}><td><strong style={{ display: 'block', minWidth: 150 }}>{group.workbook.name}</strong><span className="form-hint">Lead #{group.lead.row_number}</span></td>{leadFields.map((field) => <td key={field.id}>{displayValue(group.lead.source_values[field.field_key])}</td>)}{rowUserFields.map((field) => { const candidates = field.owner_profile_id ? group.assignments.filter((assignment) => assignment.assigned_to === field.owner_profile_id) : group.assignments.filter((assignment) => assignment.role_code === field.owner_role_code); const assignment = candidates.find((item) => item.assignment_field_values?.some((value) => value.field_id === field.id)) ?? candidates[0]; const savedValue = assignment?.assignment_field_values.find((value) => value.field_id === field.id)?.value; const editable = Boolean(assignment && assignment.assigned_to === data.userId && assignment.status === 'assigned' && (field.owner_profile_id ? field.owner_profile_id === data.userId : field.owner_role_code === assignment.role_code)); const draftKey = `${assignment?.id ?? group.lead.id}:${field.id}`; const value = drafts[draftKey] ?? (savedValue == null ? '' : String(savedValue)); return <td key={field.id}>{editable ? <div style={{ minWidth: 145, position: 'relative' }}>{field.input_type === 'dropdown' ? <select aria-label={`${field.label} for lead ${group.lead.row_number}`} value={value} disabled={busy === `${assignment.id}:${field.id}`} onChange={(event) => { setDrafts((current) => ({ ...current, [draftKey]: event.target.value })); void saveField(assignment, field, event.target.value) }}><option value="">Select…</option>{field.options.map((option) => <option value={option} key={option}>{option}</option>)}</select> : field.input_type === 'textarea' ? <textarea aria-label={`${field.label} for lead ${group.lead.row_number}`} value={value} onChange={(event) => setDrafts((current) => ({ ...current, [draftKey]: event.target.value }))} onBlur={(event) => void saveField(assignment, field, event.target.value)} rows={2} /> : <input aria-label={`${field.label} for lead ${group.lead.row_number}`} type={field.input_type === 'date' || field.input_type === 'number' ? field.input_type : 'text'} value={value} onChange={(event) => setDrafts((current) => ({ ...current, [draftKey]: event.target.value }))} onBlur={(event) => void saveField(assignment, field, event.target.value)} />}</div> : <span>{displayValue(savedValue)}</span>}</td>})}<td><div style={{ display: 'grid', gap: 4 }}>{group.assignments.map((assignment) => <span key={assignment.id} className="status-pill" data-tone={assignment.status === 'completed' ? 'neutral' : undefined}>{data.people.find((person) => person.id === assignment.assigned_to)?.full_name ?? 'Team member'} · {roleLabels.get(assignment.role_code) ?? assignment.role_code} · {assignment.status}</span>)}</div></td><td>{currentAssignment ? <button className="primary-button" style={{ whiteSpace: 'nowrap' }} onClick={() => void completeAssignment(currentAssignment)} disabled={busy === currentAssignment.id}>{busy === currentAssignment.id ? <LoaderCircle className="animate-spin" /> : <Check />} Complete</button> : <span className="form-hint">{group.assignments.some((item) => item.assigned_to === data.userId && item.status === 'completed') ? 'Submitted' : 'View only'}</span>}</td></tr>})}</tbody></table></div>}
    </section>
    {data.profile.manager_id && <div className="notice"><Check /> Updates are shared with your reporting line. Uploaded source data stays read-only in this workspace.</div>}
  </>
}
