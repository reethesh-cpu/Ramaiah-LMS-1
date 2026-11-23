'use client'

import { TransitionLink as Link } from '@/components/crm/route-transition'
import { FormEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import * as XLSX from 'xlsx'
import { ArrowLeft, ArrowRight, Check, GitBranch, LoaderCircle, Upload, UsersRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { fieldKeyFromLabel } from '@/lib/crm/field-keys'
import { mergeFlowRoles } from '@/lib/crm/reporting-flow'
import { ReportingFlowEditor } from '@/components/crm/reporting-flow-editor'

type Category = { id: string; name: string }
type Person = { id: string; full_name: string; role_code: string; is_active: boolean }
type RawRow = Record<string, string | number | boolean | null>
type HeaderDef = { key: string; label: string; required: boolean }
const supabase = createClient()

async function loadOptions() {
  const [categories, people, roles] = await Promise.all([
    supabase.from('categories').select('id,name').eq('is_active', true).order('name'),
    supabase.from('profiles').select('id,full_name,role_code,is_active').eq('is_active', true).order('full_name'),
    supabase.from('role_definitions').select('role_code,label').order('label'),
  ])
  if (categories.error || people.error || roles.error) throw new Error('Workbook setup options could not be loaded.')
  return { categories: (categories.data ?? []) as Category[], people: (people.data ?? []) as Person[], roles: roles.data ?? [] }
}

function uniqueKey(base: string, used: Set<string>) {
  const seed = base || 'column'
  if (!used.has(seed)) { used.add(seed); return seed }
  let suffix = 2
  while (used.has(`${seed}_${suffix}`)) suffix += 1
  const key = `${seed}_${suffix}`
  used.add(key)
  return key
}

export function WorkbookCreateForm() {
  const router = useRouter()
  const { data, error: optionError, isLoading } = useSWR('workbook-create-options', loadOptions)
  const [categoryId, setCategoryId] = useState('')
  const [rawRows, setRawRows] = useState<RawRow[]>([])
  const [headers, setHeaders] = useState<HeaderDef[]>([])
  const [fileName, setFileName] = useState('')
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [flowRoleCodes, setFlowRoleCodes] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState('')

  const categories = data?.categories ?? []
  const roleLabels = useMemo(() => new Map((data?.roles ?? []).map((role) => [role.role_code, role.label])), [data?.roles])
  const assignablePeople = useMemo(() => (data?.people ?? []).filter((person) => person.role_code !== 'head_office').sort((a, b) => a.full_name.localeCompare(b.full_name)), [data?.people])
  const selectedPeople = assigneeIds.map((id) => assignablePeople.find((person) => person.id === id)).filter((person): person is Person => Boolean(person))

  async function selectFile(file?: File) {
    if (!file) return
    setFormError(''); setMessage('')
    if (file.size > 10 * 1024 * 1024) { setFormError('Choose a file smaller than 10 MB.'); return }
    try {
      const bytes = await file.arrayBuffer()
      const parsed = XLSX.read(bytes, { type: 'array', cellDates: false })
      const firstSheet = parsed.Sheets[parsed.SheetNames[0]]
      if (!firstSheet) throw new Error('The file does not contain a worksheet.')
      const json = XLSX.utils.sheet_to_json<RawRow>(firstSheet, { defval: '', raw: false, blankrows: false })
      if (!json.length) throw new Error('The worksheet has no data rows.')
      if (json.length > 5000) throw new Error('The worksheet contains more than 5,000 rows.')
      const fileHeaders = Object.keys(json[0] ?? {}).map((value) => String(value).trim()).filter(Boolean)
      if (!fileHeaders.length) throw new Error('The first row must contain column headers.')
      const used = new Set<string>()
      const nextHeaders = fileHeaders.slice(0, 120).map((label) => ({ key: uniqueKey(fieldKeyFromLabel(label, 80), used), label: label.slice(0, 120), required: false }))
      setRawRows(json)
      setHeaders(nextHeaders)
      setFileName(file.name)
    } catch (caught) {
      setRawRows([]); setHeaders([]); setFileName('')
      setFormError(caught instanceof Error ? caught.message : 'The file could not be read.')
    }
  }

  function toggleAssignee(id: string) {
    const person = assignablePeople.find((candidate) => candidate.id === id)
    const wasSelected = assigneeIds.includes(id)
    setAssigneeIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
    if (!wasSelected && person) setFlowRoleCodes((current) => mergeFlowRoles(current, [person.role_code]))
  }

  async function submitWorkbook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setFormError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    if (!rawRows.length || !headers.length) { setFormError('Upload a spreadsheet so the first row can be used as workbook headers.'); setPending(false); return }
    const cleanedHeaders = headers.map((header) => ({ ...header, label: header.label.trim() }))
    if (cleanedHeaders.some((header) => !header.label)) { setFormError('Every header needs a label.'); setPending(false); return }
    // Build rows from original file columns by matching labels in order of detected headers.
    const originalHeaders = Object.keys(rawRows[0] ?? {})
    const rows = rawRows.map((row) => {
      const out: RawRow = {}
      cleanedHeaders.forEach((header, index) => {
        const original = originalHeaders[index] ?? originalHeaders.find((h) => String(h).trim() === header.label)
        out[header.key] = original ? row[original] ?? '' : ''
      })
      return out
    })
    const missingRequired = cleanedHeaders.filter((field) => field.required && rows.some((row) => row[field.key] === null || String(row[field.key] ?? '').trim() === ''))
    if (missingRequired.length) { setFormError(`Required values are missing for: ${missingRequired.map((field) => field.label).join(', ')}.`); setPending(false); return }

    const response = await fetch('/api/workbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(form.get('name')).trim(),
        category_id: categoryId,
        status: form.get('status'),
        rows,
        source_fields: cleanedHeaders.map((header) => ({ label: header.label, field_key: header.key, is_required: header.required })),
        assignee_ids: assigneeIds,
        reporting_steps: flowRoleCodes.map((role_code, index) => ({ role_code, step_order: index + 1 })),
      }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) { setFormError(result.error ?? 'The workbook could not be saved.'); setPending(false); return }
    router.push(`/admin/workbooks/${result.workbook_id}`)
    router.refresh()
  }

  if (isLoading) return <div className="empty-state"><LoaderCircle className="animate-spin" /></div>
  if (optionError) return <div className="notice" data-tone="error" role="alert">{optionError.message}</div>

  return <form onSubmit={submitWorkbook}>
    <div className="page-heading"><div><Link className="quiet-button" href="/admin/workbooks" style={{ marginBottom: 12, paddingLeft: 0 }}><ArrowLeft /> Back to workbooks</Link><div className="kicker">Import & route</div><h1>Create a workbook</h1><p>Upload an Excel or CSV file. The first row becomes the workbook headers, and the rows below are imported as leads.</p></div><div className="status-pill"><span className="status-dot" />{rawRows.length ? `${rawRows.length.toLocaleString()} rows ready` : 'No file selected'}</div></div>
    {(message || formError) && <div className="notice" data-tone={formError ? 'error' : undefined} role={formError ? 'alert' : 'status'}>{formError || message}</div>}

    <section className="card card-pad">
      <div className="kicker">01 · Workbook details</div>
      <div className="form-grid">
        <div className="form-field"><label htmlFor="workbook-name">Workbook name</label><input id="workbook-name" name="name" required maxLength={120} placeholder="e.g. Q4 inbound enquiries" /></div>
        <div className="form-field"><label htmlFor="category-id">Category</label><select id="category-id" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required><option value="">Select a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{!categories.length && <span className="form-hint">Add a category first from <Link href="/admin/categories" style={{ color: '#c8102e' }}>Categories</Link>.</span>}</div>
        <div className="form-field"><label htmlFor="workbook-status">Initial status</label><select id="workbook-status" name="status" defaultValue="active"><option value="active">Active</option><option value="ongoing">Ongoing</option></select></div>
      </div>
    </section>

    <section className="card card-pad" style={{ marginTop: 16 }}>
      <div className="kicker">02 · Upload file</div>
      <div className="form-field"><label htmlFor="lead-file">CSV or Excel file</label><label className="card" htmlFor="lead-file" style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 18, cursor: 'pointer', borderStyle: 'dashed', background: '#fffafb' }}><span className="empty-icon" style={{ margin: 0 }}><Upload /></span><span><strong>{fileName || 'Choose a spreadsheet from your device'}</strong><span className="form-hint" style={{ display: 'block', marginTop: 5 }}>CSV, XLS, or XLSX · up to 10 MB and 5,000 rows. The first row is treated as headers.</span></span><input id="lead-file" type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void selectFile(event.target.files?.[0])} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }} /></label></div>
      {headers.length > 0 && <><div className="section-head" style={{ padding: '18px 0 12px', marginTop: 8 }}><div><h2>Detected headers</h2><p>The first row became these headers. You can rename them or mark them required before importing.</p></div><span className="status-pill">{headers.length} columns</span></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Header</th><th>Required</th><th>Sample</th></tr></thead><tbody>{headers.map((header, index) => { const original = Object.keys(rawRows[0] ?? {})[index]; return <tr key={`${header.key}-${index}`}><td><input aria-label={`Header ${index + 1}`} value={header.label} onChange={(event) => setHeaders((current) => current.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} style={{ minWidth: 220 }} /></td><td><label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}><input type="checkbox" checked={header.required} onChange={(event) => setHeaders((current) => current.map((item, i) => i === index ? { ...item, required: event.target.checked } : item))} /> Required</label></td><td className="form-hint">{String(original ? rawRows[0]?.[original] ?? '—' : '—').slice(0, 80)}</td></tr> })}</tbody></table></div></>}
    </section>

    <section className="card card-pad" style={{ marginTop: 16 }}>
      <div className="kicker">03 · Reporting & notification flow</div>
      <div className="section-head" style={{ padding: '0 0 14px' }}><div><h2>Set this workbook's flow</h2><p>The lowest role sees only their own columns; each role above sees every column below it. Completion notices go to the next step up and head office.</p></div><GitBranch color="#6b6265" /></div>
      <ReportingFlowEditor value={flowRoleCodes} onChange={setFlowRoleCodes} roles={data?.roles ?? []} disabled={pending} emptyHint="No flow set. Select people below and their roles will be added here." />
      <div className="kicker" style={{ marginTop: 24 }}>04 · Assign work</div>
      <div className="section-head" style={{ padding: '0 0 14px' }}><div><h2>Choose who receives the leads</h2><p>Each selected person gets every imported lead and can fill their own user columns. Selecting someone adds their role to the flow automatically.</p></div><UsersRound color="#6b6265" /></div>
      {assignablePeople.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 }}>{assignablePeople.map((person) => { const order = assigneeIds.indexOf(person.id); const selected = order >= 0; return <label key={person.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: `1px solid ${selected ? '#e7a9b2' : 'var(--border)'}`, background: selected ? '#fffafb' : '#fff', borderRadius: 10, cursor: 'pointer' }}><input type="checkbox" checked={selected} onChange={() => toggleAssignee(person.id)} /><span style={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', background: selected ? '#c8102e' : '#f3eef0', color: selected ? '#fff' : '#8a8083', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{selected ? order + 1 : '·'}</span><span><strong style={{ display: 'block', fontSize: 12 }}>{person.full_name}</strong><span className="form-hint">{roleLabels.get(person.role_code) ?? person.role_code}</span></span>{selected && <Check size={15} style={{ marginLeft: 'auto', color: '#c8102e' }} />}</label>})}</div> : <p className="form-hint">No active assignees yet. You can assign this workbook later from its detail page.</p>}
      {selectedPeople.length ? <div className="notice" style={{ marginTop: 14 }}><UsersRound /> <span><strong>Hand-off chain:</strong> {selectedPeople.map((person, index) => <span key={person.id}>{index > 0 ? ' → ' : ' '}{person.full_name} ({roleLabels.get(person.role_code) ?? person.role_code}{flowRoleCodes.indexOf(person.role_code) >= 0 ? ` · level ${flowRoleCodes.indexOf(person.role_code) + 1}` : ''})</span>)}</span></div> : assignablePeople.length ? <p className="form-hint" style={{ marginTop: 12 }}>Select at least one person so the imported leads are moved to them.</p> : <p className="form-hint" style={{ marginTop: 12 }}>No active assignees yet. Create the workbook and assign it later from its detail page.</p>}
    </section>

    <div className="form-actions"><Link className="secondary-button" href="/admin/workbooks">Cancel</Link><button className="primary-button" disabled={pending || !categories.length || !rawRows.length || (assignablePeople.length > 0 && !assigneeIds.length)}>{pending ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{pending ? 'Importing…' : `Create workbook${rawRows.length ? ` · ${rawRows.length} leads` : ''}`}</button></div>
  </form>
}
