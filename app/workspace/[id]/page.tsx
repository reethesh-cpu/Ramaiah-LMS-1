'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import * as XLSX from 'xlsx'
import { ArrowLeft, Check, FileSpreadsheet, LoaderCircle, Pencil, Search, Send, UsersRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Field = { id: string; template_id: string | null; field_key: string; label: string; field_kind: 'source' | 'user'; owner_role_code: string | null; owner_profile_id: string | null; input_type: string; options: string[]; is_required: boolean; sort_order: number }
type Assignment = { id: string; lead_id: string; assigned_to: string; role_code: string; status: 'assigned' | 'completed'; assigned_at: string; completed_at: string | null; assignment_field_values: Array<{ field_id: string; value: unknown; updated_at: string }> }
type Lead = { id: string; row_number: number; source_values: Record<string, string | number | boolean | null> }
type Person = { id: string; full_name: string; role_code: string }
type Workbook = { id: string; name: string; status: string; template_id: string; categories: { name: string } | null; templates: { name: string } | null }
type DetailData = { userId: string; profile: Person; roles: Array<{ role_code: string; label: string }>; people: Person[]; fields: Field[]; workbook: Workbook; leads: Lead[]; assignments: Assignment[] }
const supabase = createClient()

async function loadFields(templateId: string) {
  const full = await supabase.from('template_fields').select('id,template_id,field_key,label,field_kind,owner_role_code,owner_profile_id,input_type,options,is_required,sort_order').or(`template_id.eq.${templateId},template_id.is.null`).order('sort_order')
  if (!full.error) return full
  return supabase.from('template_fields').select('id,template_id,field_key,label,field_kind,owner_role_code,input_type,options,is_required,sort_order').or(`template_id.eq.${templateId},template_id.is.null`).order('sort_order')
}

async function loadDetail(workbookId: string): Promise<DetailData> {
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Sign in again to load this workbook.')
  const [profileResult, rolesResult, peopleResult, workbookResult] = await Promise.all([
    supabase.from('profiles').select('id,full_name,role_code').eq('id', user.id).single(),
    supabase.from('role_definitions').select('role_code,label'),
    supabase.from('profiles').select('id,full_name,role_code'),
    supabase.from('workbooks').select('id,name,status,template_id,categories(name),templates(name)').eq('id', workbookId).maybeSingle(),
  ])
  if (profileResult.error || !profileResult.data || rolesResult.error || peopleResult.error || workbookResult.error || !workbookResult.data) throw new Error('This workbook is not available to you.')
  const workbook = workbookResult.data as unknown as Workbook
  const [fieldsResult, leadsResult] = await Promise.all([
    loadFields(workbook.template_id),
    supabase.from('lead_records').select('id,row_number,source_values').eq('workbook_id', workbookId).order('row_number').range(0, 4999),
  ])
  if (fieldsResult.error || leadsResult.error) throw new Error('This workbook could not be loaded.')
  const leads = (leadsResult.data ?? []) as Lead[]
  const { data: assignments, error: assignmentError } = leads.length
    ? await supabase.from('lead_assignments').select('id,lead_id,assigned_to,role_code,status,assigned_at,completed_at,assignment_field_values(field_id,value,updated_at)').in('lead_id', leads.map((lead) => lead.id)).order('assigned_at', { ascending: false }).range(0, 49999)
    : { data: [], error: null }
  if (assignmentError) throw new Error('Assignments for this workbook could not be loaded.')
  return {
    userId: user.id,
    profile: profileResult.data as Person,
    roles: rolesResult.data ?? [],
    people: (peopleResult.data ?? []) as Person[],
    fields: (fieldsResult.data ?? []) as Field[],
    workbook,
    leads,
    assignments: (assignments ?? []) as unknown as Assignment[],
  }
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export default function WorkspaceWorkbookPage() {
  const params = useParams<{ id: string }>()
  const workbookId = params?.id ?? ''
  const { data, error, isLoading, mutate } = useSWR(['workspace-workbook', workbookId], () => loadDetail(workbookId))
  const [search, setSearch] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [notifyBusy, setNotifyBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')
  const [editingLeadIds, setEditingLeadIds] = useState<Set<string>>(new Set())
  const roleLabels = useMemo(() => new Map((data?.roles ?? []).map((role) => [role.role_code, role.label])), [data?.roles])
  const assignmentsByLead = useMemo(() => {
    const map = new Map<string, Assignment[]>()
    for (const assignment of data?.assignments ?? []) map.set(assignment.lead_id, [...(map.get(assignment.lead_id) ?? []), assignment])
    return map
  }, [data?.assignments])
  const sourceFields = useMemo(() => (data?.fields ?? []).filter((field) => field.field_kind === 'source').sort((a, b) => a.sort_order - b.sort_order), [data?.fields])
  const visibleRoleCodes = new Set((data?.assignments ?? []).map((assignment) => assignment.role_code))
  if (data) visibleRoleCodes.add(data.profile.role_code)
  const visibleAssigneeIds = new Set((data?.assignments ?? []).map((assignment) => assignment.assigned_to))
  if (data) visibleAssigneeIds.add(data.userId)
  const userFields = (data?.fields ?? []).filter((field) => field.field_kind === 'user' && (
    field.owner_profile_id ? visibleAssigneeIds.has(field.owner_profile_id) : Boolean(field.owner_role_code && visibleRoleCodes.has(field.owner_role_code))
  ))
  const leads = data?.leads ?? []
  const visibleLeads = useMemo(() => leads.filter((lead) => Object.values(lead.source_values).join(' ').toLowerCase().includes(search.toLowerCase())), [leads, search])
  const openWorkLeads = useMemo(() => visibleLeads.filter((lead) => { const mine = (data?.assignments ?? []).find((a) => a.lead_id === lead.id && a.assigned_to === data?.userId); return !mine || mine.status === 'assigned' }), [visibleLeads, data?.assignments, data?.userId])
  const myCompletedLeads = useMemo(() => visibleLeads.filter((lead) => (data?.assignments ?? []).find((a) => a.lead_id === lead.id && a.assigned_to === data?.userId)?.status === 'completed'), [visibleLeads, data?.assignments, data?.userId])
  function toggleEdit(leadId: string) { setEditingLeadIds((current) => { const next = new Set(current); if (next.has(leadId)) next.delete(leadId); else next.add(leadId); return next }) }

  function ownerLabelFor(field: Field) {
    if (field.owner_profile_id) return data?.people.find((person) => person.id === field.owner_profile_id)?.full_name ?? 'Team member'
    return roleLabels.get(field.owner_role_code ?? '') ?? field.owner_role_code ?? 'Team'
  }
  const ownOpenAssignments = (data?.assignments ?? []).filter((assignment) => assignment.assigned_to === data?.userId && assignment.status === 'assigned').length
  const completedCount = (data?.assignments ?? []).filter((assignment) => assignment.assigned_to === data?.userId && assignment.status === 'completed').length

  async function saveField(assignment: Assignment, field: Field, value: string) {
    const key = `${assignment.id}:${field.id}`
    setBusy(key); setFormError('')
    const { error: saveError } = await supabase.from('assignment_field_values').upsert({ assignment_id: assignment.id, field_id: field.id, value: value === '' ? null : value, updated_by: data?.userId }, { onConflict: 'assignment_id,field_id' })
    if (saveError) setFormError('This field could not be saved. Only the assigned user can edit their own columns.')
    else { setNotice('Update saved. Changes are visible to the reporting levels above you in this workbook.'); await mutate() }
    setBusy('')
  }

  async function completeAssignment(assignment: Assignment) {
    setBusy(assignment.id); setFormError(''); setNotice('')
    const { error: completeError } = await supabase.rpc('complete_assignment', { target_assignment_id: assignment.id })
    if (completeError) setFormError(completeError.message.includes('required') ? completeError.message : 'Assignment could not be completed. Review required fields and try again.')
    else { setNotice('Lead marked complete and moved to your completed work.'); await mutate() }
    setBusy('')
  }

  async function notifyManager() {
    setNotifyBusy(true); setFormError(''); setNotice('')
    const res = await fetch('/api/notifications/notify-manager', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workbook_id: workbookId }) })
    const result = await res.json().catch(() => ({}))
    if (!res.ok) setFormError(result.error ?? 'Notification could not be sent.')
    else setNotice(`Notification sent to ${(result.recipients as string[])?.join(', ') ?? 'the next level and head office'}.${result.sent ? ` ${result.sent} email${result.sent === 1 ? '' : 's'} delivered.` : ' Email delivery will happen when Gmail is configured.'}`)
    setNotifyBusy(false)
  }

  function downloadView() {
    if (!data) return
    const rows = visibleLeads.map((lead) => {
      const assignments = assignmentsByLead.get(lead.id) ?? []
      const row: Record<string, unknown> = { 'Lead row': lead.row_number, ...lead.source_values }
      for (const field of userFields) {
        const assignment = field.owner_profile_id
          ? assignments.find((item) => item.assigned_to === field.owner_profile_id)
          : assignments.find((item) => item.role_code === field.owner_role_code && item.assignment_field_values?.some((value) => value.field_id === field.id)) ?? assignments.find((item) => item.role_code === field.owner_role_code)
        row[`${ownerLabelFor(field)} · ${field.label}`] = assignment?.assignment_field_values.find((value) => value.field_id === field.id)?.value ?? ''
      }
      row['Assigned team'] = assignments.map((assignment) => `${data.people.find((person) => person.id === assignment.assigned_to)?.full_name ?? 'Team member'} (${roleLabels.get(assignment.role_code) ?? assignment.role_code})`).join(', ')
      row['Work status'] = assignments.map((assignment) => `${roleLabels.get(assignment.role_code) ?? assignment.role_code}: ${assignment.status}`).join(', ')
      return row
    })
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Leads')
    XLSX.writeFile(book, `${data.workbook.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'workbook'}.xlsx`)
  }

  if (isLoading) return <div className="empty-state"><LoaderCircle className="animate-spin" /></div>
  if (error || !data) return <div className="notice" data-tone="error" role="alert">{error?.message ?? 'This workbook could not be loaded.'}</div>

  function renderLeadRow(lead: Lead) {
    const d = data!
    const assignments = assignmentsByLead.get(lead.id) ?? []
    const currentAssignment = assignments.find((a) => a.assigned_to === d.userId && a.status === 'assigned')
    const completedAssignment = assignments.find((a) => a.assigned_to === d.userId && a.status === 'completed')
    const isEditing = editingLeadIds.has(lead.id)
    return <tr key={lead.id}>
      <td><strong style={{ display: 'block', minWidth: 90 }}>Lead #{lead.row_number}</strong></td>
      {sourceFields.map((field) => <td key={field.id}>{displayValue(lead.source_values[field.field_key])}</td>)}
      {userFields.map((field) => {
        const candidates = field.owner_profile_id ? assignments.filter((a) => a.assigned_to === field.owner_profile_id) : assignments.filter((a) => a.role_code === field.owner_role_code)
        const assignment = candidates.find((item) => item.assignment_field_values?.some((v) => v.field_id === field.id)) ?? candidates[0]
        const savedValue = assignment?.assignment_field_values.find((v) => v.field_id === field.id)?.value
        const editable = Boolean(assignment && assignment.assigned_to === d.userId && (assignment.status === 'assigned' || (assignment.status === 'completed' && isEditing)) && (field.owner_profile_id ? field.owner_profile_id === d.userId : field.owner_role_code === assignment.role_code))
        const draftKey = `${assignment?.id ?? lead.id}:${field.id}`
        const value = drafts[draftKey] ?? (savedValue == null ? '' : String(savedValue))
        return <td key={field.id}>{editable ? <div style={{ minWidth: 145, position: 'relative' }}>{field.input_type === 'dropdown' ? <select aria-label={`${field.label} for lead ${lead.row_number}`} value={value} disabled={busy === `${assignment.id}:${field.id}`} onChange={(event) => { setDrafts((current) => ({ ...current, [draftKey]: event.target.value })); void saveField(assignment, field, event.target.value) }}><option value="">Select…</option>{field.options.map((option) => <option value={option} key={option}>{option}</option>)}</select> : field.input_type === 'textarea' ? <textarea aria-label={`${field.label} for lead ${lead.row_number}`} value={value} onChange={(event) => setDrafts((current) => ({ ...current, [draftKey]: event.target.value }))} onBlur={(event) => void saveField(assignment, field, event.target.value)} rows={2} /> : <input aria-label={`${field.label} for lead ${lead.row_number}`} type={field.input_type === 'date' || field.input_type === 'number' ? field.input_type : 'text'} value={value} onChange={(event) => setDrafts((current) => ({ ...current, [draftKey]: event.target.value }))} onBlur={(event) => void saveField(assignment, field, event.target.value)} />}</div> : <span>{displayValue(savedValue)}</span>}</td>
      })}
      <td><div style={{ display: 'grid', gap: 4 }}>{assignments.map((assignment) => <span key={assignment.id} className="status-pill" data-tone={assignment.status === 'completed' ? 'neutral' : undefined}>{d.people.find((person) => person.id === assignment.assigned_to)?.full_name ?? 'Team member'} · {roleLabels.get(assignment.role_code) ?? assignment.role_code} · {assignment.status}</span>)}</div></td>
      <td>{currentAssignment ? <button className="primary-button" style={{ whiteSpace: 'nowrap' }} onClick={() => void completeAssignment(currentAssignment)} disabled={busy === currentAssignment.id}>{busy === currentAssignment.id ? <LoaderCircle className="animate-spin" /> : <Check />} Complete</button> : completedAssignment ? (isEditing ? <button className="primary-button" style={{ whiteSpace: 'nowrap' }} onClick={() => toggleEdit(lead.id)}><Check /> Done</button> : <button className="secondary-button" style={{ whiteSpace: 'nowrap' }} onClick={() => toggleEdit(lead.id)}><Pencil /> Edit</button>) : <span className="form-hint">View only</span>}</td>
    </tr>
  }

  const tableHeader = <thead><tr><th>Lead</th>{sourceFields.map((field) => <th key={field.id}>{field.label}</th>)}{userFields.map((field) => <th key={field.id}>{ownerLabelFor(field)} · {field.label}</th>)}<th>Team status</th><th>Action</th></tr></thead>

  return <>
    <div className="page-heading"><div><Link className="quiet-button" href="/workspace" style={{ marginBottom: 12, paddingLeft: 0 }}><ArrowLeft /> Back to workbooks</Link><div className="kicker">{data.workbook.categories?.name ?? 'Workbook'} · {data.workbook.templates?.name ?? 'Template'}</div><h1>{data.workbook.name}</h1><p>Review the leads in this workbook, update your own columns, and submit completed work.</p></div><div className="toolbar-actions"><span className="status-pill" data-tone={data.workbook.status === 'closed' ? 'neutral' : data.workbook.status === 'ongoing' ? 'amber' : undefined}><span className="status-dot" />{data.workbook.status}</span><button className="secondary-button" onClick={notifyManager} disabled={notifyBusy}>{notifyBusy ? <LoaderCircle className="animate-spin" /> : <Send />} Notify manager</button><button className="secondary-button" onClick={downloadView}><FileSpreadsheet /> Export view</button></div></div>
    {(notice || formError) && <div className="notice" data-tone={formError ? 'error' : undefined} role={formError ? 'alert' : 'status'}>{formError || notice}</div>}
    <section className="stat-grid stat-grid-compact"><article className="card stat-card"><div className="stat-top">Open assignments<span className="stat-icon"><Send /></span></div><div className="stat-value">{ownOpenAssignments}</div><div className="form-hint">Assigned directly to you</div></article><article className="card stat-card"><div className="stat-top">Completed<span className="stat-icon"><Check /></span></div><div className="stat-value">{completedCount}</div><div className="form-hint">Submitted by you</div></article><article className="card stat-card"><div className="stat-top">Visible leads<span className="stat-icon"><UsersRound /></span></div><div className="stat-value">{leads.length}</div><div className="form-hint">Visible through this workbook's flow</div></article></section>
    <section className="card section-card"><div className="toolbar-row"><div><h2 style={{ margin: 0 }}>Open work</h2><span className="form-hint">Leads assigned to you and your team. Press Complete when your columns are filled.</span></div><div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 11, top: 10, color: '#8a8083' }} /><input className="toolbar-search" style={{ paddingLeft: 34 }} aria-label="Search leads" placeholder="Search leads" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div>
      {!openWorkLeads.length ? <div className="empty-state"><span className="empty-icon"><FileSpreadsheet /></span><h3>{leads.length ? 'No open work matching your search' : 'Nothing assigned in this workbook'}</h3><p>{leads.length ? 'Try a different search term.' : 'When work is assigned to you or your role is in this workbook\'s flow, it will appear here.'}</p></div> : <div className="table-wrap"><table className="data-table">{tableHeader}<tbody>{openWorkLeads.map(renderLeadRow)}</tbody></table></div>}
    </section>
    {myCompletedLeads.length > 0 && <section className="card section-card" style={{ marginTop: 16 }}><div className="section-head"><div><h2>Completed work</h2><p>Leads you finished. Press Edit to update your columns, then Done to save.</p></div><span className="status-pill" data-tone="neutral"><span className="status-dot" />{myCompletedLeads.length} completed</span></div>
      <div className="table-wrap"><table className="data-table">{tableHeader}<tbody>{myCompletedLeads.map(renderLeadRow)}</tbody></table></div>
    </section>}
    <div className="notice"><Check /> Updates are shared with the reporting levels above you in this workbook's flow. Uploaded source data stays read-only in this workspace.</div>
  </>
}
