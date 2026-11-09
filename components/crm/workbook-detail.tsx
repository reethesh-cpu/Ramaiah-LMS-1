'use client'

import Link from 'next/link'
import { FormEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import * as XLSX from 'xlsx'
import { ArrowLeft, Bell, Check, Download, Flag, LoaderCircle, Mail, Save, Send, UserRoundPlus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Workbook = { id: string; name: string; status: string; is_prioritized: boolean; category_id: string; template_id: string; created_at: string; categories: { name: string } | null; templates: { name: string } | null }
type Lead = { id: string; workbook_id: string; row_number: number; source_values: Record<string, string | number | boolean | null> }
type Field = { id: string; field_key: string; label: string; field_kind: 'source' | 'user'; owner_role_code: string | null; owner_profile_id: string | null; input_type: string; options: string[]; is_required: boolean; sort_order: number }
type Person = { id: string; full_name: string; email: string; role_code: string; is_active: boolean }
type Assignment = { id: string; lead_id: string; assigned_to: string; role_code: string; status: string; assigned_at: string; completed_at: string | null; assignment_field_values: Array<{ field_id: string; value: unknown; updated_at: string }> }
type DetailData = { workbook: Workbook; leads: Lead[]; fields: Field[]; people: Person[]; assignments: Assignment[]; roles: Array<{ role_code: string; label: string }> }
const supabase = createClient()

async function loadFields(templateId: string) {
  const full = await supabase.from('template_fields').select('id,field_key,label,field_kind,owner_role_code,owner_profile_id,input_type,options,is_required,sort_order').eq('template_id', templateId).order('sort_order')
  if (!full.error) return full
  return supabase.from('template_fields').select('id,field_key,label,field_kind,owner_role_code,input_type,options,is_required,sort_order').eq('template_id', templateId).order('sort_order')
}

async function loadWorkbook(id: string): Promise<DetailData> {
  const { data: workbook, error: workbookError } = await supabase.from('workbooks').select('id,name,status,is_prioritized,category_id,template_id,created_at,categories(name),templates(name)').eq('id', id).maybeSingle()
  if (workbookError || !workbook) throw new Error('Workbook could not be loaded.')
  const [leadResult, fieldResult, peopleResult, roleResult] = await Promise.all([
    supabase.from('lead_records').select('id,workbook_id,row_number,source_values').eq('workbook_id', id).order('row_number').range(0, 4999),
    loadFields(workbook.template_id),
    supabase.from('profiles').select('id,full_name,email,role_code,is_active').order('full_name'),
    supabase.from('role_definitions').select('role_code,label'),
  ])
  if (leadResult.error || fieldResult.error || peopleResult.error || roleResult.error) throw new Error('Workbook details could not be loaded.')
  const leads = (leadResult.data ?? []) as Lead[]
  const { data: assignments, error: assignmentError } = leads.length
    ? await supabase.from('lead_assignments').select('id,lead_id,assigned_to,role_code,status,assigned_at,completed_at,assignment_field_values(field_id,value,updated_at)').in('lead_id', leads.map((lead) => lead.id)).order('assigned_at', { ascending: false }).range(0, 49999)
    : { data: [], error: null }
  if (assignmentError) throw new Error('Assignment details could not be loaded.')
  return { workbook: workbook as unknown as Workbook, leads, fields: (fieldResult.data ?? []) as Field[], people: (peopleResult.data ?? []) as Person[], assignments: (assignments ?? []) as unknown as Assignment[], roles: roleResult.data ?? [] }
}

export function WorkbookDetail({ workbookId }: { workbookId: string }) {
  const router = useRouter()
  const { data, error, isLoading, mutate } = useSWR(['workbook-detail', workbookId], () => loadWorkbook(workbookId))
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([])
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [editName, setEditName] = useState('')
  const [editStatus, setEditStatus] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [notifyPending, setNotifyPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')
  const workbook = data?.workbook
  const sourceFields = useMemo(() => data?.fields.filter((field) => field.field_kind === 'source') ?? [], [data?.fields])
  const userFields = useMemo(() => data?.fields.filter((field) => field.field_kind === 'user') ?? [], [data?.fields])
  const roleLabels = new Map((data?.roles ?? []).map((role) => [role.role_code, role.label]))
  const personById = new Map((data?.people ?? []).map((person) => [person.id, person]))
  const assignablePeople = useMemo(() => {
    const roleOrder = ['telecaller', 'team_member', 'agm', 'hr', 'ceo']
    return (data?.people ?? [])
      .filter((person) => person.is_active && person.role_code !== 'head_office')
      .sort((a, b) => {
        const aIndex = roleOrder.indexOf(a.role_code)
        const bIndex = roleOrder.indexOf(b.role_code)
        return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex) || a.full_name.localeCompare(b.full_name)
      })
  }, [data?.people])
  function ownerLabelFor(field: Field) {
    if (field.owner_profile_id) return personById.get(field.owner_profile_id)?.full_name ?? 'Team member'
    return roleLabels.get(field.owner_role_code ?? '') ?? field.owner_role_code ?? 'Team'
  }
  const assignmentsByLead = useMemo(() => {
    const groups = new Map<string, Assignment[]>()
    for (const assignment of data?.assignments ?? []) groups.set(assignment.lead_id, [...(groups.get(assignment.lead_id) ?? []), assignment])
    return groups
  }, [data?.assignments])

  async function saveWorkbook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!workbook) return
    setPending(true); setFormError(''); setNotice('')
    const response = await fetch(`/api/workbooks/${workbook.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editName || workbook.name, status: editStatus || workbook.status }) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) setFormError(result.error ?? 'Workbook changes could not be saved.')
    else { setNotice('Workbook details updated.'); await mutate() }
    setPending(false)
  }

  async function togglePriority() {
    if (!workbook) return
    const response = await fetch(`/api/workbooks/${workbook.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_prioritized: !workbook.is_prioritized }) })
    if (!response.ok) setFormError('Priority could not be updated.')
    else { setNotice(workbook.is_prioritized ? 'Priority removed.' : 'Workbook prioritized.'); await mutate() }
  }

  async function notifyAssignees() {
    if (!workbook) return
    setNotifyPending(true); setFormError(''); setNotice('')
    const notifyRes = await fetch('/api/notifications/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workbook_id: workbook.id }) })
    const notifyResult = await notifyRes.json().catch(() => ({}))
    if (!notifyRes.ok) { setFormError(notifyResult.error ?? 'Notifications could not be created.'); setNotifyPending(false); return }
    const sendRes = await fetch('/api/notifications/send', { method: 'POST' })
    const sendResult = await sendRes.json().catch(() => ({}))
    if (!sendRes.ok) { setNotice(`${notifyResult.notified_count} notification${notifyResult.notified_count === 1 ? '' : 's'} created. Gmail sending is not yet configured — connect a Gmail account to deliver them.`); setNotifyPending(false); return }
    setNotice(`${notifyResult.notified_count} notification${notifyResult.notified_count === 1 ? '' : 's'} created. ${sendResult.sent ?? 0} email${sendResult.sent === 1 ? '' : 's'} sent${sendResult.failed ? `, ${sendResult.failed} failed` : ''}.`)
    setNotifyPending(false)
  }

  async function saveSourceValue(lead: Lead, field: Field) {
    const key = `${lead.id}:${field.field_key}`
    const nextValue = drafts[key]
    if (nextValue === undefined || nextValue === String(lead.source_values[field.field_key] ?? '')) return
    const sourceValues = { ...lead.source_values, [field.field_key]: nextValue }
    const { error: updateError } = await supabase.from('lead_records').update({ source_values: sourceValues }).eq('id', lead.id)
    if (updateError) setFormError(`Could not update ${field.label}.`)
    else { setNotice(`${field.label} updated.`); await mutate() }
  }

  async function assignSelected() {
    if (!data || !assigneeIds.length) return
    const leadIds = selectedLeadIds.length ? selectedLeadIds : data.leads.map((lead) => lead.id)
    if (!leadIds.length) return
    setPending(true); setFormError(''); setNotice('')
    const response = await fetch('/api/assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_ids: leadIds, assignee_ids: assigneeIds }) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) setFormError(result.error ?? 'The leads could not be assigned.')
    else {
      const created = Number(result.assigned_count ?? 0)
      const skipped = Number(result.skipped_count ?? 0)
      setNotice(created
        ? `${created} assignment${created === 1 ? '' : 's'} created${skipped ? `; ${skipped} already existed and were skipped` : ''}. Email notices were added to the Supabase outbox.`
        : 'Those leads were already assigned to the selected team members, so nothing changed.')
      setSelectedLeadIds([]); setAssigneeIds([]); await mutate()
    }
    setPending(false)
  }

  function downloadWorkbook() {
    if (!data || !workbook) return
    const rows = data.leads.map((lead) => {
      const assignments = assignmentsByLead.get(lead.id) ?? []
      const row: Record<string, unknown> = { 'Lead row': lead.row_number, ...lead.source_values }
      for (const field of userFields) {
        const owner = field.owner_profile_id
          ? assignments.find((item) => item.assigned_to === field.owner_profile_id)
          : [...assignments].find((item) => item.role_code === field.owner_role_code && item.assignment_field_values?.some((value) => value.field_id === field.id)) ?? assignments.find((item) => item.role_code === field.owner_role_code)
        const value = owner?.assignment_field_values.find((item) => item.field_id === field.id)?.value
        row[`${ownerLabelFor(field)} · ${field.label}`] = value ?? ''
      }
      row['Assigned to'] = assignments.map((item) => `${personById.get(item.assigned_to)?.full_name ?? 'User'} (${roleLabels.get(item.role_code) ?? item.role_code})`).join(', ')
      row['Assignment status'] = assignments.map((item) => `${roleLabels.get(item.role_code) ?? item.role_code}: ${item.status}`).join(', ')
      return row
    })
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Leads')
    XLSX.writeFile(book, `${workbook.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'workbook'}.xlsx`)
  }

  function toggleLead(id: string) { setSelectedLeadIds((current) => current.includes(id) ? current.filter((leadId) => leadId !== id) : [...current, id]) }
  function toggleAssignee(id: string) { setAssigneeIds((current) => current.includes(id) ? current.filter((personId) => personId !== id) : [...current, id]) }

  if (isLoading) return <div className="empty-state"><LoaderCircle className="animate-spin" /></div>
  if (error || !data || !workbook) return <div className="notice" data-tone="error" role="alert">{error?.message ?? 'Workbook could not be loaded.'}</div>
  const allSelected = data.leads.length > 0 && selectedLeadIds.length === data.leads.length

  return <>
    <div className="page-heading"><div><Link className="quiet-button" href="/admin/workbooks" style={{ marginBottom: 12, paddingLeft: 0 }}><ArrowLeft /> Back to workbooks</Link><div className="kicker">{workbook.categories?.name ?? 'Workbook'} · {data.leads.length} leads</div><h1>{workbook.name}</h1><p>{workbook.templates?.name ?? 'Template'} · Created {new Date(workbook.created_at).toLocaleDateString()}</p></div><div className="toolbar-actions"><button className="primary-button" onClick={notifyAssignees} disabled={notifyPending || !data?.leads.length}>{notifyPending ? <LoaderCircle className="animate-spin" /> : <Bell />} Notify assignees</button><button className="secondary-button" onClick={togglePriority}><Flag />{workbook.is_prioritized ? 'Prioritized' : 'Prioritize'}</button><button className="secondary-button" onClick={downloadWorkbook}><Download /> Download Excel</button></div></div>
    {(notice || formError) && <div className="notice" data-tone={formError ? 'error' : undefined} role={formError ? 'alert' : 'status'}>{formError || notice}</div>}
    <section className="card card-pad">
      <div className="section-head" style={{ padding: '0 0 14px' }}><div><h2>Workbook settings</h2><p>Update the name and lifecycle status.</p></div><span className="status-pill" data-tone={workbook.status === 'closed' ? 'neutral' : workbook.status === 'ongoing' ? 'amber' : undefined}><span className="status-dot" />{workbook.status}</span></div>
      <form onSubmit={saveWorkbook}><div className="form-grid"><div className="form-field"><label htmlFor="edit-name">Workbook name</label><input id="edit-name" value={editName || workbook.name} onChange={(event) => setEditName(event.target.value)} maxLength={120} /></div><div className="form-field"><label htmlFor="edit-status">Status</label><select id="edit-status" value={editStatus || workbook.status} onChange={(event) => setEditStatus(event.target.value)}><option value="active">Active</option><option value="ongoing">Ongoing</option><option value="closed">Closed</option></select></div></div><div className="form-actions"><button className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <Save />} Save workbook</button></div></form>
    </section>
    <section className="card section-card"><div className="section-head"><div><h2>Move leads to your team</h2><p>{selectedLeadIds.length ? `${selectedLeadIds.length} leads selected` : 'Select rows below, or leave empty to assign every lead.'} Each selected lead receives a separate assignment for every chosen person, and re-running this only adds people who do not already have it.</p></div><button className="primary-button" onClick={assignSelected} disabled={pending || !assigneeIds.length || !data.leads.length}>{pending ? <LoaderCircle className="animate-spin" /> : <Send />} Assign leads</button></div>
      {assignablePeople.length ? <div className="toolbar-row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>{assignablePeople.map((person) => { const order = assigneeIds.indexOf(person.id); const selected = order >= 0; return <label key={person.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', border: `1px solid ${selected ? '#e7a9b2' : 'var(--border)'}`, background: selected ? '#fffafb' : '#fff', borderRadius: 8, cursor: 'pointer' }}><input type="checkbox" checked={selected} onChange={() => toggleAssignee(person.id)} /><span style={{ width: 18, height: 18, borderRadius: '50%', display: 'grid', placeItems: 'center', background: selected ? '#c8102e' : '#f3eef0', color: selected ? '#fff' : '#8a8083', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{selected ? order + 1 : '·'}</span><span style={{ fontSize: 11, fontWeight: 600 }}>{person.full_name}</span><span className="form-hint">{roleLabels.get(person.role_code) ?? person.role_code}</span></label>})}</div> : <div className="toolbar-row"><span className="form-hint">No active assignees available. Add users from People & access.</span></div>}
      {assigneeIds.length ? <div className="notice" style={{ margin: '12px 16px 16px' }}><Send /> <span><strong>Hand-off chain:</strong> {assigneeIds.map((id) => personById.get(id)?.full_name ?? 'Team member').join(' → ')}</span></div> : null}
    </section>
    <section className="card section-card"><div className="section-head"><div><h2>Lead records</h2><p>Imported source data remains read-only for assignees. Head office can edit source values.</p></div><span className="status-pill">{data.leads.length.toLocaleString()} rows</span></div>
      {!data.leads.length ? <div className="empty-state"><h3>This workbook has no records</h3><p>Upload a CSV or Excel file to populate the workbook.</p></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th><input type="checkbox" aria-label="Select all leads" checked={allSelected} onChange={() => setSelectedLeadIds(allSelected ? [] : data.leads.map((lead) => lead.id))} /></th><th>Row</th>{sourceFields.map((field) => <th key={field.id}>{field.label}</th>)}{userFields.map((field) => <th key={field.id}>{ownerLabelFor(field)} · {field.label}</th>)}<th>Assigned team</th></tr></thead><tbody>{data.leads.map((lead) => { const assignments = assignmentsByLead.get(lead.id) ?? []; return <tr key={lead.id}><td><input type="checkbox" aria-label={`Select lead row ${lead.row_number}`} checked={selectedLeadIds.includes(lead.id)} onChange={() => toggleLead(lead.id)} /></td><td>{lead.row_number}</td>{sourceFields.map((field) => { const key = `${lead.id}:${field.field_key}`; const value = drafts[key] ?? String(lead.source_values[field.field_key] ?? ''); return <td key={field.id}><input aria-label={`Row ${lead.row_number} ${field.label}`} value={value} type={field.input_type === 'date' ? 'date' : field.input_type === 'number' ? 'number' : 'text'} onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))} onBlur={() => void saveSourceValue(lead, field)} style={{ minWidth: 90, fontSize: 12 }} /></td>})}{userFields.map((field) => { const ownerAssignment = field.owner_profile_id ? assignments.find((item) => item.assigned_to === field.owner_profile_id) : [...assignments].find((item) => item.role_code === field.owner_role_code && item.assignment_field_values?.some((value) => value.field_id === field.id)) ?? assignments.find((item) => item.role_code === field.owner_role_code); const value = ownerAssignment?.assignment_field_values.find((item) => item.field_id === field.id)?.value; return <td key={field.id}>{value == null || value === '' ? '—' : String(value)}</td> })}<td>{assignments.length ? assignments.map((assignment) => <div key={assignment.id} style={{ marginBottom: 4 }}><span className="status-pill" data-tone={assignment.status === 'completed' ? 'neutral' : undefined}>{personById.get(assignment.assigned_to)?.full_name ?? 'Team member'} · {roleLabels.get(assignment.role_code) ?? assignment.role_code} · {assignment.status}</span></div>) : <span className="form-hint">Unassigned</span>}</td></tr>})}</tbody></table></div>}
    </section>
    {data.assignments.some((assignment) => assignment.assignment_field_values?.length) && <section className="card section-card"><div className="section-head"><div><h2>Team updates</h2><p>Role-specific values are visible according to the reporting hierarchy.</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Lead row</th><th>Team member</th><th>Role</th><th>Status</th><th>Submitted fields</th><th>Last update</th></tr></thead><tbody>{data.assignments.filter((assignment) => assignment.assignment_field_values?.length).map((assignment) => <tr key={assignment.id}><td>{data.leads.find((lead) => lead.id === assignment.lead_id)?.row_number ?? '—'}</td><td>{personById.get(assignment.assigned_to)?.full_name ?? 'Team member'}</td><td>{roleLabels.get(assignment.role_code) ?? assignment.role_code}</td><td>{assignment.status}</td><td>{assignment.assignment_field_values.map((value) => { const field = data.fields.find((item) => item.id === value.field_id); return field ? `${ownerLabelFor(field)} · ${field.label}: ${String(value.value ?? '')}` : '' }).filter(Boolean).join(' · ')}</td><td>{new Date(assignment.assignment_field_values[0].updated_at).toLocaleString()}</td></tr>)}</tbody></table></div></section>}
    <div className="notice"><Check /> Assignment notifications are recorded in the Supabase outbox. Google Mail API delivery will begin once its sender credential is connected; no third-party mail sender is used.</div>
  </>
}
