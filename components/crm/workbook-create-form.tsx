'use client'

import { TransitionLink as Link } from '@/components/crm/route-transition'
import { FormEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { ArrowLeft, ArrowRight, Check, GitBranch, LoaderCircle, Upload, UsersRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { fieldKeyFromLabel } from '@/lib/crm/field-keys'
import { mergeFlowRoles } from '@/lib/crm/reporting-flow'
import { buildHeaderColumns, dataRows as readDataRows, parseSheet, type DataRow, type ParsedSheet } from '@/lib/crm/excel-sheet'
import { ReportingFlowEditor } from '@/components/crm/reporting-flow-editor'

type Category = { id: string; name: string }
type Person = { id: string; full_name: string; role_code: string; is_active: boolean }
type RawRow = Record<string, string | number | boolean | null>
type ColumnDraft = {
  key: string
  columnIndex: number
  letter: string
  label: string
  headerPath: string[]
  sample: string
  kind: 'source' | 'user'
  ownerProfileId: string
  required: boolean
}
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

function makeColumns(sheet: ParsedSheet, headerRows: number, previous: ColumnDraft[] = []): ColumnDraft[] {
  const before = new Map(previous.map((column) => [column.columnIndex, column]))
  const used = new Set<string>()
  return buildHeaderColumns(sheet, headerRows).map((column) => {
    const old = before.get(column.columnIndex)
    return {
      ...column,
      key: uniqueKey(fieldKeyFromLabel(column.label, 80), used),
      kind: old?.kind ?? 'source',
      ownerProfileId: old?.ownerProfileId ?? '',
      required: old?.required ?? false,
    }
  })
}

export function WorkbookCreateForm() {
  const router = useRouter()
  const { data, error: optionError, isLoading } = useSWR('workbook-create-options', loadOptions)
  const [categoryId, setCategoryId] = useState('')
  const [sheet, setSheet] = useState<ParsedSheet | null>(null)
  const [fileName, setFileName] = useState('')
  const [headerRows, setHeaderRows] = useState(1)
  const [columns, setColumns] = useState<ColumnDraft[]>([])
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [flowRoleCodes, setFlowRoleCodes] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState('')

  const categories = data?.categories ?? []
  const allPeople = data?.people ?? []
  const roleLabels = useMemo(() => new Map((data?.roles ?? []).map((role) => [role.role_code, role.label])), [data?.roles])
  const assignablePeople = useMemo(() => allPeople.filter((person) => person.role_code !== 'head_office').sort((a, b) => a.full_name.localeCompare(b.full_name)), [allPeople])
  const selectedPeople = assigneeIds.map((id) => assignablePeople.find((person) => person.id === id)).filter((person): person is Person => Boolean(person))
  const dataRows = useMemo<DataRow[]>(() => sheet ? readDataRows(sheet, headerRows) : [], [sheet, headerRows])
  const sourceColumns = columns.filter((column) => column.kind === 'source')
  const userColumns = columns.filter((column) => column.kind === 'user')
  const maxHeaderRows = sheet ? Math.min(10, Math.max(1, sheet.rowCount - 1)) : 1

  async function selectFile(file?: File) {
    if (!file) return
    setFormError(''); setMessage('')
    if (file.size > 10 * 1024 * 1024) { setFormError('Choose a file smaller than 10 MB.'); return }
    try {
      const bytes = await file.arrayBuffer()
      const parsed = parseSheet(bytes)
      if (parsed.rowCount < 2) throw new Error('The worksheet needs header rows and at least one data row.')
      setSheet(parsed)
      setFileName(file.name)
      setHeaderRows(1)
      setColumns(makeColumns(parsed, 1))
    } catch (caught) {
      setSheet(null); setColumns([]); setFileName(''); setHeaderRows(1)
      setFormError(caught instanceof Error ? caught.message : 'The file could not be read.')
    }
  }

  function changeHeaderRows(count: number) {
    setHeaderRows(count)
    if (sheet) setColumns(makeColumns(sheet, count, columns))
  }

  function updateColumn(index: number, change: Partial<ColumnDraft>) {
    setColumns((current) => current.map((column, position) => position === index ? { ...column, ...change } : column))
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
    if (!sheet || !columns.length || !dataRows.length) { setFormError('Upload a spreadsheet with headers and at least one data row.'); setPending(false); return }
    if (!sourceColumns.length) { setFormError('At least one column must stay a source header.'); setPending(false); return }
    if (columns.some((column) => !column.label.trim())) { setFormError('Every header needs a label.'); setPending(false); return }
    if (userColumns.some((column) => !column.ownerProfileId)) { setFormError('Choose who owns each user input column.'); setPending(false); return }

    const rows = dataRows.map((row) => {
      const out: RawRow = {}
      for (const column of sourceColumns) out[column.key] = row.cells[column.columnIndex] ?? ''
      return out
    })
    const missingRequired = sourceColumns.filter((column) => column.required && rows.some((row) => row[column.key] === null || String(row[column.key] ?? '').trim() === ''))
    if (missingRequired.length) { setFormError(`Required values are missing for: ${missingRequired.map((column) => column.label).join(', ')}.`); setPending(false); return }

    const response = await fetch('/api/workbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(form.get('name')).trim(),
        category_id: categoryId,
        status: form.get('status'),
        header_rows: headerRows,
        row_numbers: dataRows.map((row) => row.excelRow),
        rows,
        source_fields: sourceColumns.map((column) => ({ label: column.label, field_key: column.key, is_required: column.required, header_path: column.headerPath })),
        user_fields: userColumns.map((column) => ({ label: column.label, field_key: column.key, header_path: column.headerPath, owner_profile_id: column.ownerProfileId, is_required: column.required, input_type: 'text', options: [] })),
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
    <div className="page-heading"><div><Link className="quiet-button" href="/admin/workbooks" style={{ marginBottom: 12, paddingLeft: 0 }}><ArrowLeft /> Back to workbooks</Link><div className="kicker">Import & route</div><h1>Create a workbook</h1><p>Upload an Excel or CSV file. Choose which top rows are headers; merged and multi-row headers are combined, and assignees get their input columns from the first real data row.</p></div><div className="status-pill"><span className="status-dot" />{dataRows.length ? `${dataRows.length.toLocaleString()} data rows` : 'No file selected'}</div></div>
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
      <div className="kicker">02 · Upload file &amp; headers</div>
      <div className="form-field"><label htmlFor="lead-file">CSV or Excel file</label><label className="card" htmlFor="lead-file" style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 18, cursor: 'pointer', borderStyle: 'dashed', background: '#fffafb' }}><span className="empty-icon" style={{ margin: 0 }}><Upload /></span><span><strong>{fileName || 'Choose a spreadsheet from your device'}</strong><span className="form-hint" style={{ display: 'block', marginTop: 5 }}>CSV, XLS, or XLSX · up to 10 MB and 5,000 data rows. Merged cells and multiple header rows are supported.</span></span><input id="lead-file" type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void selectFile(event.target.files?.[0])} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }} /></label></div>
      {sheet && <div className="form-grid" style={{ marginTop: 14 }}>
        <div className="form-field"><label htmlFor="header-rows">Header rows</label><select id="header-rows" value={headerRows} onChange={(event) => changeHeaderRows(Number(event.target.value))}>{Array.from({ length: maxHeaderRows }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count === 1 ? 'Row 1 only' : `Rows 1–${count}`}</option>)}</select><span className="form-hint">Choose the rows that form the header. Their values are combined into one label per column.</span></div>
        <div className="form-field"><label>Data starts at</label><div className="status-pill" style={{ alignSelf: 'flex-start' }}><span className="status-dot" />Excel row {headerRows + 1}</div><span className="form-hint">Assignees get their input columns from this row onward, not from row 2.</span></div>
      </div>}
      {columns.length > 0 && <><div className="section-head" style={{ padding: '18px 0 12px', marginTop: 8 }}><div><h2>Imported columns</h2><p>Source columns keep the file values. User columns are added for the selected owner and appear in the same table for input.</p></div><span className="status-pill">{columns.length} columns · {dataRows.length} rows</span></div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Excel</th><th>Combined header</th><th>Header rows</th><th>Sample</th><th>Type</th><th>Owner</th><th>Required</th></tr></thead><tbody>{columns.map((column, index) => <tr key={`${column.key}-${column.columnIndex}`}>
          <td style={{ fontWeight: 650 }}>{column.letter}</td>
          <td><input aria-label={`Header ${column.letter}`} value={column.label} onChange={(event) => updateColumn(index, { label: event.target.value })} style={{ minWidth: 210 }} /></td>
          <td className="form-hint" style={{ whiteSpace: 'normal', maxWidth: 220 }}>{column.headerPath.filter(Boolean).join(' / ') || '—'}</td>
          <td className="form-hint">{column.sample || '—'}</td>
          <td><select aria-label={`Type for ${column.letter}`} value={column.kind} onChange={(event) => updateColumn(index, { kind: event.target.value as ColumnDraft['kind'] })}><option value="source">Source</option><option value="user">User input</option></select></td>
          <td>{column.kind === 'user' ? <select aria-label={`Owner for ${column.letter}`} value={column.ownerProfileId} onChange={(event) => updateColumn(index, { ownerProfileId: event.target.value })}><option value="">Select person</option>{allPeople.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select> : <span className="form-hint">—</span>}</td>
          <td><label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}><input type="checkbox" checked={column.required} onChange={(event) => updateColumn(index, { required: event.target.checked })} /> Required</label></td>
        </tr>)}</tbody></table></div></>}
    </section>

    <section className="card card-pad" style={{ marginTop: 16 }}>
      <div className="kicker">03 · Reporting &amp; notification flow</div>
      <div className="section-head" style={{ padding: '0 0 14px' }}><div><h2>Set this workbook's flow</h2><p>The lowest role sees only their own columns; each role above sees every column below it. Completion notices go to the next step up and head office.</p></div><GitBranch color="#6b6265" /></div>
      <ReportingFlowEditor value={flowRoleCodes} onChange={setFlowRoleCodes} roles={data?.roles ?? []} disabled={pending} emptyHint="No flow set. Select people below and their roles will be added here." />
      <div className="kicker" style={{ marginTop: 24 }}>04 · Assign work</div>
      <div className="section-head" style={{ padding: '0 0 14px' }}><div><h2>Choose who receives the leads</h2><p>Each selected person gets every imported data row and can fill their own user columns. Selecting someone adds their role to the flow automatically.</p></div><UsersRound color="#6b6265" /></div>
      {assignablePeople.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 }}>{assignablePeople.map((person) => { const order = assigneeIds.indexOf(person.id); const selected = order >= 0; return <label key={person.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: `1px solid ${selected ? '#e7a9b2' : 'var(--border)'}`, background: selected ? '#fffafb' : '#fff', borderRadius: 10, cursor: 'pointer' }}><input type="checkbox" checked={selected} onChange={() => toggleAssignee(person.id)} /><span style={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', background: selected ? '#c8102e' : '#f3eef0', color: selected ? '#fff' : '#8a8083', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{selected ? order + 1 : '·'}</span><span><strong style={{ display: 'block', fontSize: 12 }}>{person.full_name}</strong><span className="form-hint">{roleLabels.get(person.role_code) ?? person.role_code}</span></span>{selected && <Check size={15} style={{ marginLeft: 'auto', color: '#c8102e' }} />}</label>})}</div> : <p className="form-hint">No active assignees yet. You can assign this workbook later from its detail page.</p>}
      {selectedPeople.length ? <div className="notice" style={{ marginTop: 14 }}><UsersRound /> <span><strong>Hand-off chain:</strong> {selectedPeople.map((person, index) => <span key={person.id}>{index > 0 ? ' → ' : ' '}{person.full_name} ({roleLabels.get(person.role_code) ?? person.role_code}{flowRoleCodes.indexOf(person.role_code) >= 0 ? ` · level ${flowRoleCodes.indexOf(person.role_code) + 1}` : ''})</span>)}</span></div> : assignablePeople.length ? <p className="form-hint" style={{ marginTop: 12 }}>Select at least one person so the imported leads are moved to them.</p> : <p className="form-hint" style={{ marginTop: 12 }}>No active assignees yet. Create the workbook and assign it later from its detail page.</p>}
    </section>

    <div className="form-actions"><Link className="secondary-button" href="/admin/workbooks">Cancel</Link><button className="primary-button" disabled={pending || !categories.length || !dataRows.length || !sourceColumns.length || (assignablePeople.length > 0 && !assigneeIds.length)}>{pending ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{pending ? 'Importing…' : `Create workbook${dataRows.length ? ` · ${dataRows.length} leads` : ''}`}</button></div>
  </form>
}
