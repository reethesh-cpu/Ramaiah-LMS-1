'use client'

import Link from 'next/link'
import { FormEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import * as XLSX from 'xlsx'
import { ArrowLeft, ArrowRight, Check, CircleAlert, FileSpreadsheet, LoaderCircle, Upload, UsersRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Category = { id: string; name: string }
type Template = { id: string; name: string; category_id: string | null }
type Field = { id: string; template_id: string; field_key: string; label: string; field_kind: string; is_required: boolean; sort_order: number }
type Person = { id: string; full_name: string; role_code: string; is_active: boolean }
type RawRow = Record<string, string | number | boolean | null>
const supabase = createClient()

async function loadOptions() {
  const [categories, templates, fields, people, roles] = await Promise.all([
    supabase.from('categories').select('id,name').eq('is_active', true).order('name'),
    supabase.from('templates').select('id,name,category_id').order('name'),
    supabase.from('template_fields').select('id,template_id,field_key,label,field_kind,is_required,sort_order').order('sort_order'),
    supabase.from('profiles').select('id,full_name,role_code,is_active').eq('is_active', true).order('full_name'),
    supabase.from('role_definitions').select('role_code,label'),
  ])
  if (categories.error || templates.error || fields.error || people.error || roles.error) throw new Error('Workbook setup options could not be loaded.')
  return { categories: (categories.data ?? []) as Category[], templates: (templates.data ?? []) as Template[], fields: (fields.data ?? []) as Field[], people: (people.data ?? []) as Person[], roles: roles.data ?? [] }
}

function normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '') }

export function WorkbookCreateForm() {
  const router = useRouter()
  const { data, error: optionError, isLoading } = useSWR('workbook-create-options', loadOptions)
  const [categoryId, setCategoryId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [rawRows, setRawRows] = useState<RawRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [fileName, setFileName] = useState('')
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState('')
  const categories = data?.categories ?? []
  const allTemplates = data?.templates ?? []
  const templates = allTemplates.filter((template) => !template.category_id || !categoryId || template.category_id === categoryId)
  const selectedTemplateId = templateId && templates.some((template) => template.id === templateId) ? templateId : templates[0]?.id ?? ''
  const sourceFields = useMemo(() => (data?.fields ?? []).filter((field) => field.template_id === selectedTemplateId && field.field_kind === 'source').sort((a, b) => a.sort_order - b.sort_order), [data?.fields, selectedTemplateId])
  const roleLabels = new Map((data?.roles ?? []).map((role) => [role.role_code, role.label]))
  const assignablePeople = useMemo(() => {
    const roleOrder = ['telecaller', 'team_member', 'agm', 'hr', 'ceo']
    return (data?.people ?? [])
      .filter((person) => person.role_code !== 'head_office')
      .sort((a, b) => {
        const aIndex = roleOrder.indexOf(a.role_code)
        const bIndex = roleOrder.indexOf(b.role_code)
        return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex) || a.full_name.localeCompare(b.full_name)
      })
  }, [data?.people])
  const selectedPeople = assigneeIds.map((id) => assignablePeople.find((person) => person.id === id)).filter((person): person is Person => Boolean(person))

  function autoMap(fileHeaders: string[], currentTemplateId: string) {
    const fields = (data?.fields ?? []).filter((field) => field.template_id === currentTemplateId && field.field_kind === 'source')
    const next: Record<string, string> = {}
    for (const header of fileHeaders) {
      const match = fields.find((field) => normalize(field.label) === normalize(header) || normalize(field.field_key) === normalize(header))
      next[header] = match?.field_key ?? ''
    }
    return next
  }

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
      const fileHeaders = Object.keys(json[0] ?? {})
      if (!fileHeaders.length) throw new Error('The first row must contain column headers.')
      setRawRows(json); setHeaders(fileHeaders); setMapping(autoMap(fileHeaders, selectedTemplateId)); setFileName(file.name)
    } catch (caught) {
      setRawRows([]); setHeaders([]); setMapping({}); setFileName('')
      setFormError(caught instanceof Error ? caught.message : 'The file could not be read.')
    }
  }

  function changeTemplate(nextId: string) {
    setTemplateId(nextId)
    setMapping(autoMap(headers, nextId))
  }

  function toggleAssignee(id: string) {
    setAssigneeIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function submitWorkbook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setFormError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    if (!rawRows.length || !headers.length || !sourceFields.length) { setFormError('Upload a spreadsheet and select a template with source fields.'); setPending(false); return }
    const selectedKeys = headers.map((header) => mapping[header]).filter(Boolean)
    if (!selectedKeys.length || new Set(selectedKeys).size !== selectedKeys.length) { setFormError('Map each source column to a unique template field.'); setPending(false); return }
    const missing = sourceFields.filter((field) => field.is_required && !selectedKeys.includes(field.field_key))
    if (missing.length) { setFormError(`Map required columns: ${missing.map((field) => field.label).join(', ')}.`); setPending(false); return }
    const rows = rawRows.map((row) => Object.fromEntries(headers.filter((header) => mapping[header]).map((header) => [mapping[header], row[header]])))
    const requiredSourceFields = sourceFields.filter((field) => field.is_required)
    if (rows.some((row) => requiredSourceFields.some((field) => row[field.field_key] === null || String(row[field.field_key] ?? '').trim() === ''))) {
      setFormError('Some rows have blank values in required columns. Correct the file and upload it again.'); setPending(false); return
    }
    const response = await fetch('/api/workbooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: String(form.get('name')).trim(), category_id: categoryId, template_id: selectedTemplateId, status: form.get('status'), rows, assignee_ids: assigneeIds }) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) { setFormError(result.error ?? 'The workbook could not be saved.'); setPending(false); return }
    router.push(`/admin/workbooks/${result.workbook_id}`)
    router.refresh()
  }

  if (isLoading) return <div className="empty-state"><LoaderCircle className="animate-spin" /></div>
  if (optionError) return <div className="notice" data-tone="error" role="alert">{optionError.message}</div>

  return <form onSubmit={submitWorkbook}>
    <div className="page-heading"><div><Link className="quiet-button" href="/admin/workbooks" style={{ marginBottom: 12, paddingLeft: 0 }}><ArrowLeft /> Back to workbooks</Link><div className="kicker">Import & route</div><h1>Create a workbook</h1><p>Choose a category and template, match the file columns, then assign the leads.</p></div><div className="status-pill"><span className="status-dot" />{rawRows.length ? `${rawRows.length.toLocaleString()} rows ready` : 'No file selected'}</div></div>
    {(message || formError) && <div className="notice" data-tone={formError ? 'error' : undefined} role={formError ? 'alert' : 'status'}>{formError || message}</div>}
    <section className="card card-pad">
      <div className="kicker">01 · Workbook details</div>
      <div className="form-grid">
        <div className="form-field"><label htmlFor="workbook-name">Workbook name</label><input id="workbook-name" name="name" required maxLength={120} placeholder="e.g. Q4 inbound enquiries" /></div>
        <div className="form-field"><label htmlFor="category-id">Category</label><select id="category-id" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setTemplateId('') }} required><option value="">Select a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{!categories.length && <span className="form-hint">Add a category first from <Link href="/admin/categories" style={{ color: '#c8102e' }}>Categories</Link>.</span>}</div>
        <div className="form-field"><label htmlFor="template-id">Header template</label><select id="template-id" value={selectedTemplateId} onChange={(event) => changeTemplate(event.target.value)} required><option value="">Select a template</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>{!templates.length && <span className="form-hint">Create a template first from <Link href="/admin/templates" style={{ color: '#c8102e' }}>Templates & headers</Link>.</span>}</div>
        <div className="form-field"><label htmlFor="workbook-status">Initial status</label><select id="workbook-status" name="status" defaultValue="active"><option value="active">Active</option><option value="ongoing">Ongoing</option></select></div>
      </div>
    </section>
    <section className="card card-pad" style={{ marginTop: 16 }}>
      <div className="kicker">02 · Upload and match</div>
      <div className="form-field"><label htmlFor="lead-file">CSV or Excel file</label><label className="card" htmlFor="lead-file" style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 18, cursor: 'pointer', borderStyle: 'dashed', background: '#fffafb' }}><span className="empty-icon" style={{ margin: 0 }}><Upload /></span><span><strong>{fileName || 'Choose a spreadsheet from your device'}</strong><span className="form-hint" style={{ display: 'block', marginTop: 5 }}>CSV, XLS, or XLSX · up to 10 MB and 5,000 rows</span></span><input id="lead-file" type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void selectFile(event.target.files?.[0])} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }} /></label></div>
      {headers.length > 0 && <><div className="section-head" style={{ padding: '18px 0 12px', marginTop: 8 }}><div><h2>Match file columns to template</h2><p>Matching is suggested by header name; review each column.</p></div><span className="status-pill">{headers.length} file columns</span></div><div className="table-wrap"><table className="data-table"><thead><tr><th>File header</th><th>Sample value</th><th>Template field</th></tr></thead><tbody>{headers.map((header) => <tr key={header}><td style={{ fontWeight: 650 }}>{header}</td><td className="form-hint">{String(rawRows[0]?.[header] ?? '—').slice(0, 80)}</td><td><select aria-label={`Map ${header} to a template field`} value={mapping[header] ?? ''} onChange={(event) => setMapping((current) => ({ ...current, [header]: event.target.value }))} style={{ minHeight: 34, minWidth: 200, border: '1px solid var(--border)', borderRadius: 8, padding: '0 9px', background: '#fff', fontSize: 11 }}><option value="">Do not import this column</option>{sourceFields.map((field) => <option key={field.field_key} value={field.field_key} disabled={headers.some((other) => other !== header && mapping[other] === field.field_key)}>{field.label}{field.is_required ? ' · required' : ''}</option>)}</select></td></tr>)}</tbody></table></div></>}
      {selectedTemplateId && sourceFields.length === 0 && <div className="notice" data-tone="error"><CircleAlert />The selected template has no uploaded-data fields. Add source columns to the template before continuing.</div>}
    </section>
    <section className="card card-pad" style={{ marginTop: 16 }}>
      <div className="kicker">03 · Assign work</div><div className="section-head" style={{ padding: '0 0 14px' }}><div><h2>Choose the hand-off chain</h2><p>Pick the people who should receive these leads, in order — for example telecaller → AGM → HR → CEO. Each selected person gets every imported lead and can fill their own columns. Reporting managers see the work automatically, even if they are not selected.</p></div><UsersRound color="#6b6265" /></div>
      {assignablePeople.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 }}>{assignablePeople.map((person) => { const order = assigneeIds.indexOf(person.id); const selected = order >= 0; return <label key={person.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: `1px solid ${selected ? '#e7a9b2' : 'var(--border)'}`, background: selected ? '#fffafb' : '#fff', borderRadius: 10, cursor: 'pointer' }}><input type="checkbox" checked={selected} onChange={() => toggleAssignee(person.id)} /><span style={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', background: selected ? '#c8102e' : '#f3eef0', color: selected ? '#fff' : '#8a8083', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{selected ? order + 1 : '·'}</span><span><strong style={{ display: 'block', fontSize: 12 }}>{person.full_name}</strong><span className="form-hint">{roleLabels.get(person.role_code) ?? person.role_code}</span></span>{selected && <Check size={15} style={{ marginLeft: 'auto', color: '#c8102e' }} />}</label>})}</div> : <p className="form-hint">No active assignees yet. You can assign this workbook later from its detail page.</p>}
      {selectedPeople.length ? <div className="notice" style={{ marginTop: 14 }}><UsersRound /> <span><strong>Hand-off chain:</strong> {selectedPeople.map((person, index) => <span key={person.id}>{index > 0 ? ' → ' : ' '}{person.full_name} ({roleLabels.get(person.role_code) ?? person.role_code})</span>)}</span></div> : assignablePeople.length ? <p className="form-hint" style={{ marginTop: 12 }}>Select at least one person so the imported leads are moved to them. You can also create the workbook now and assign it later from its detail page.</p> : null}
    </section>
    <div className="form-actions"><Link className="secondary-button" href="/admin/workbooks">Cancel</Link><button className="primary-button" disabled={pending || !categories.length || !selectedTemplateId || !rawRows.length}>{pending ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{pending ? 'Importing…' : `Create workbook${rawRows.length ? ` · ${rawRows.length} leads` : ''}`}</button></div>
  </form>
}
