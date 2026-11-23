'use client'

import { TransitionLink as Link } from '@/components/crm/route-transition'
import { FormEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { ArrowLeft, ArrowRight, Check, GitBranch, LoaderCircle, Plus, Trash2, Upload, UsersRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { fieldKeyFromLabel } from '@/lib/crm/field-keys'
import { mergeFlowRoles } from '@/lib/crm/reporting-flow'
import {
  buildHeaderColumns, buildMergeSpans, dataRows as readDataRows, detectDataStartRow,
  parseSheet, valueAt, type ParsedSheet,
} from '@/lib/crm/excel-sheet'
import { ReportingFlowEditor } from '@/components/crm/reporting-flow-editor'

type Category = { id: string; name: string }
type Person = { id: string; full_name: string; role_code: string; is_active: boolean }
type RawRow = Record<string, string | number | boolean | null>
type UserColumn = { id: number; label: string; ownerProfileId: string; required: boolean; inputType: string; options: string }
type ExistingUserField = {
  id: string; label: string; owner_profile_id: string | null; owner_role_code: string | null;
  input_type: string; options: string[]; is_required: boolean; template_id: string | null; workbook_id?: string | null
}
const supabase = createClient()

async function loadOptions() {
  const [categories, people, roles, fieldsResult] = await Promise.all([
    supabase.from('categories').select('id,name').eq('is_active', true).order('name'),
    supabase.from('profiles').select('id,full_name,role_code,is_active').eq('is_active', true).order('full_name'),
    supabase.from('role_definitions').select('role_code,label').order('label'),
    supabase.from('template_fields').select('id,label,field_kind,owner_profile_id,owner_role_code,input_type,options,is_required,template_id,workbook_id,sort_order').eq('field_kind', 'user').order('label'),
  ])
  if (categories.error || people.error || roles.error) throw new Error('Workbook setup options could not be loaded.')
  // Older projects may not have workbook_id on template_fields yet. Keep setup
  // usable and simply treat every returned user column as shared in that case.
  const fields = fieldsResult.error
    ? (await supabase.from('template_fields').select('id,label,field_kind,owner_profile_id,owner_role_code,input_type,options,is_required,template_id,sort_order').eq('field_kind', 'user').order('label')).data ?? []
    : fieldsResult.data ?? []
  const existingUserFields = (fields as ExistingUserField[]).filter((field) => !field.workbook_id && !field.template_id)
  return { categories: (categories.data ?? []) as Category[], people: (people.data ?? []) as Person[], roles: roles.data ?? [], existingUserFields }
}

export function WorkbookCreateForm() {
  const router = useRouter()
  const { data, error: optionError, isLoading } = useSWR('workbook-create-options', loadOptions)
  const [categoryId, setCategoryId] = useState('')
  const [sheet, setSheet] = useState<ParsedSheet | null>(null)
  const [fileName, setFileName] = useState('')
  const [dataStartRow, setDataStartRow] = useState(2)
  const [userColumns, setUserColumns] = useState<UserColumn[]>([])
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [flowRoleCodes, setFlowRoleCodes] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState('')

  const categories = data?.categories ?? []
  const allPeople = data?.people ?? []
  const roleLabels = useMemo(() => new Map((data?.roles ?? []).map((role) => [role.role_code, role.label])), [data?.roles])
  const existingUserFields = data?.existingUserFields ?? []
  function existingOwnerLabel(field: ExistingUserField) {
    if (field.owner_profile_id) return allPeople.find((person) => person.id === field.owner_profile_id)?.full_name ?? 'Removed person'
    return roleLabels.get(field.owner_role_code ?? '') ?? field.owner_role_code ?? 'Team'
  }
  const assignablePeople = useMemo(() => allPeople.filter((person) => person.role_code !== 'head_office').sort((a, b) => a.full_name.localeCompare(b.full_name)), [allPeople])
  const selectedPeople = assigneeIds.map((id) => assignablePeople.find((person) => person.id === id)).filter((person): person is Person => Boolean(person))
  const sheetColumns = useMemo(() => sheet ? buildHeaderColumns(sheet, Math.max(0, dataStartRow - 1)) : [], [sheet, dataStartRow])
  const dataRows = useMemo(() => sheet ? readDataRows(sheet, dataStartRow) : [], [sheet, dataStartRow])
  const previewRows = Math.min(sheet?.rowCount ?? 0, 12)
  const previewSpans = useMemo(() => sheet ? buildMergeSpans(previewRows, sheet.columnCount, sheet.merges) : null, [sheet, previewRows])

  async function selectFile(file?: File) {
    if (!file) return
    setFormError(''); setMessage('')
    if (file.size > 10 * 1024 * 1024) { setFormError('Choose a file smaller than 10 MB.'); return }
    try {
      const bytes = await file.arrayBuffer()
      const parsed = parseSheet(bytes)
      if (parsed.rowCount < 2) throw new Error('The worksheet needs at least a header row and a data row.')
      setSheet(parsed)
      setFileName(file.name)
      setDataStartRow(Math.min(detectDataStartRow(parsed), parsed.rowCount))
      setUserColumns([])
    } catch (caught) {
      setSheet(null); setFileName(''); setUserColumns([])
      setFormError(caught instanceof Error ? caught.message : 'The file could not be read.')
    }
  }

  function addUserColumn() {
    setUserColumns((current) => [...current, {
      id: Date.now() + current.length,
      label: '',
      ownerProfileId: allPeople[0]?.id ?? '',
      required: false,
      inputType: 'text',
      options: '',
    }])
  }

  function updateUserColumn(id: number, change: Partial<UserColumn>) {
    setUserColumns((current) => current.map((column) => column.id === id ? { ...column, ...change } : column))
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
    if (!sheet || !sheetColumns.length || !dataRows.length) { setFormError('Upload a spreadsheet with at least one column and one data row.'); setPending(false); return }
    if (dataStartRow > sheet.rowCount) { setFormError('The data start row is beyond the uploaded sheet.'); setPending(false); return }
    if (userColumns.some((column) => !column.label.trim() || !column.ownerProfileId)) { setFormError('Every added user column needs a label and an owner.'); setPending(false); return }
    const newLabels = userColumns.map((column) => column.label.trim().toLowerCase())
    if (new Set(newLabels).size !== newLabels.length) { setFormError('Each new user column needs a different label.'); setPending(false); return }
    const duplicateExisting = existingUserFields.find((field) => newLabels.includes(field.label.trim().toLowerCase()))
    if (duplicateExisting) { setFormError(`“${duplicateExisting.label}” is already defined in User columns. It is available in this workbook automatically — do not add it again.`); setPending(false); return }

    // Keep every column and every row exactly as uploaded. No header is removed
    // or renamed: blank cells stay blank and row numbers stay the Excel numbers.
    const rows = dataRows.map((row) => {
      const out: RawRow = {}
      for (let index = 0; index < sheet.columnCount; index++) out[`col_${index}`] = row.cells[index] ?? ''
      return out
    })

    const response = await fetch('/api/workbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(form.get('name')).trim(),
        category_id: categoryId,
        status: form.get('status'),
        header_rows: Math.max(0, dataStartRow - 1),
        data_start_row: dataStartRow,
        sheet_cells: sheet.rows,
        sheet_merges: sheet.merges,
        column_count: sheet.columnCount,
        row_numbers: dataRows.map((row) => row.excelRow),
        rows,
        source_fields: sheetColumns.map((column) => ({
          label: column.label,
          field_key: `col_${column.columnIndex}`,
          is_required: false,
          header_path: column.headerPath,
          column_index: column.columnIndex,
        })),
        user_fields: userColumns.map((column) => ({
          label: column.label.trim(),
          field_key: `user_${fieldKeyFromLabel(column.label, 60)}_${column.id}`,
          header_path: [],
          column_index: null,
          owner_profile_id: column.ownerProfileId,
          is_required: column.required,
          input_type: column.inputType,
          options: column.options.split(',').map((option) => option.trim()).filter(Boolean),
        })),
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
    <div className="page-heading"><div><Link className="quiet-button" href="/admin/workbooks" style={{ marginBottom: 12, paddingLeft: 0 }}><ArrowLeft /> Back to workbooks</Link><div className="kicker">Import & route</div><h1>Create a workbook</h1><p>Upload the Excel file as it is. Rows, columns and merged cells are kept unchanged. Choose where the real data starts; user columns already created in User columns are added automatically.</p></div><div className="status-pill"><span className="status-dot" />{dataRows.length ? `${dataRows.length.toLocaleString()} saved rows` : 'No file selected'}</div></div>
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
      <div className="kicker">02 · Upload file &amp; choose data start</div>
      <div className="form-field"><label htmlFor="lead-file">CSV or Excel file</label><label className="card" htmlFor="lead-file" style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 18, cursor: 'pointer', borderStyle: 'dashed', background: '#fffafb' }}><span className="empty-icon" style={{ margin: 0 }}><Upload /></span><span><strong>{fileName || 'Choose a spreadsheet from your device'}</strong><span className="form-hint" style={{ display: 'block', marginTop: 5 }}>CSV, XLS, or XLSX · up to 10 MB and 5,000 data rows. The file is saved exactly as uploaded.</span></span><input id="lead-file" type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void selectFile(event.target.files?.[0])} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }} /></label></div>
      {!sheet ? <p className="form-hint" style={{ marginTop: 12 }}>Upload a file, then choose the Excel row where real data starts. Rows above it stay as headings.</p> : <>
        <div className="notice" style={{ marginTop: 14, background: '#fff8f8', borderColor: '#f3d7da' }}>
          <strong>Choose the first data row</strong>
          <span>Rows 1–{Math.max(0, dataStartRow - 1)} are headings and appear in the red header style. Row {dataStartRow} onward are data rows. Click a row in the preview or use the box below.</span>
        </div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <div className="form-field"><label htmlFor="data-start-row">Excel row where actual data starts</label><input id="data-start-row" type="number" min={1} max={sheet.rowCount} value={dataStartRow} onChange={(event) => setDataStartRow(Math.min(sheet.rowCount, Math.max(1, Number(event.target.value) || 1)))} /><span className="form-hint">Nothing is renamed or removed. Only the row number changes which rows are shown as headers.</span></div>
          <div className="form-field"><label>Saved sheet</label><div className="status-pill" style={{ alignSelf: 'flex-start' }}><span className="status-dot" />{sheet.rowCount} rows · {sheet.columnCount} columns · {sheet.merges.length} merges</div><span className="form-hint">{dataRows.length} rows will become data, starting at Excel row {dataStartRow}.</span></div>
        </div>
        {previewSpans && <div style={{ marginTop: 18 }}>
          <div className="section-head" style={{ padding: '0 0 10px' }}><div><h2>Uploaded sheet preview</h2><p>Pale red = heading rows. Solid red = the first data row. Merged cells are detected automatically and appear merged in the workbook.</p></div><span className="status-pill">First {previewRows} rows</span></div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Excel row</th>{Array.from({ length: sheet.columnCount }, (_, index) => <th key={index}>{String.fromCharCode(65 + (index % 26))}{index >= 26 ? Math.floor(index / 26) : ''}</th>)}</tr></thead><tbody>{Array.from({ length: previewRows }, (_, row) => {
            const excelRow = row + 1
            const isStart = excelRow === dataStartRow
            const isHeader = excelRow < dataStartRow
            return <tr key={row} style={isStart ? { background: '#c8102e', color: '#fff' } : isHeader ? { background: '#fde9ec' } : undefined}>
              <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}><span>{excelRow}</span><button type="button" className="quiet-button" style={{ marginLeft: 8, minHeight: 24, padding: '0 7px', fontSize: 10, background: isStart ? '#fff' : undefined, color: isStart ? '#c8102e' : undefined }} disabled={isStart} onClick={() => setDataStartRow(excelRow)}>{isStart ? 'Data starts' : 'Set as start'}</button></td>
              {Array.from({ length: sheet.columnCount }, (_, column) => {
                const key = `${row}:${column}`
                if (previewSpans.covered.has(key)) return null
                const span = previewSpans.spans.get(key) ?? { rowSpan: 1, colSpan: 1 }
                return <td key={key} rowSpan={span.rowSpan} colSpan={span.colSpan} style={isHeader ? { fontWeight: 600, background: '#fde9ec', color: '#8a0f1f' } : isStart ? { color: '#fff', fontWeight: 650 } : undefined}>{valueAt(sheet.rows, sheet.merges, row, column)}</td>
              })}
            </tr>
          })}</tbody></table></div>
        </div>}
      </>}
    </section>

    <section className="card card-pad" style={{ marginTop: 16 }}>
      <div className="kicker">03 · User columns</div>
      <div className="section-head" style={{ padding: '0 0 12px' }}><div><h2>Columns you already created</h2><p>Shared columns from <strong>User columns</strong> are available in this workbook automatically. Add a new one below only when the column does not exist yet.</p></div><Link className="secondary-button" href="/admin/user-columns"><UsersRound /> Manage user columns</Link></div>
      {existingUserFields.length ? <div className="table-wrap" style={{ marginBottom: 18 }}><table className="data-table"><thead><tr><th>Column</th><th>Owner</th><th>Input</th><th>Required</th><th>Availability</th></tr></thead><tbody>{existingUserFields.map((field) => <tr key={field.id}><td style={{ fontWeight: 650 }}>{field.label}</td><td>{existingOwnerLabel(field)}</td><td>{field.input_type}</td><td>{field.is_required ? 'Required' : 'Optional'}</td><td><span className="status-pill"><span className="status-dot" />Added automatically</span></td></tr>)}</tbody></table></div> : <div className="notice" style={{ marginBottom: 18 }}><UsersRound /> No shared user columns yet. <Link href="/admin/user-columns" style={{ color: '#c8102e', fontWeight: 650 }}>Create them here</Link> and they will appear in every workbook.</div>}
      <div className="section-head" style={{ padding: '0 0 12px', borderTop: '1px solid var(--border)', paddingTop: 16 }}><div><h2>Add a new column (optional)</h2><p>These extra columns do not change any column or value imported from the Excel file.</p></div></div>
      {userColumns.map((column) => <div className="form-grid" key={column.id} style={{ marginBottom: 8 }}>
        <div className="form-field"><label>Column label</label><input aria-label="User column label" value={column.label} onChange={(event) => updateUserColumn(column.id, { label: event.target.value })} placeholder="e.g. Verification remarks" /></div>
        <div className="form-field"><label>Owner</label><select aria-label="User column owner" value={column.ownerProfileId} onChange={(event) => updateUserColumn(column.id, { ownerProfileId: event.target.value })}><option value="">Select person</option>{allPeople.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select></div>
        <div className="form-field"><label>Input type</label><select aria-label="User column input type" value={column.inputType} onChange={(event) => updateUserColumn(column.id, { inputType: event.target.value })}><option value="text">Text</option><option value="textarea">Long text</option><option value="number">Number</option><option value="date">Date</option><option value="dropdown">Dropdown</option></select></div>
        <div className="form-field"><label>Required</label><label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 9 }}><input type="checkbox" checked={column.required} onChange={(event) => updateUserColumn(column.id, { required: event.target.checked })} /> Must be filled before completion</label></div>
        {column.inputType === 'dropdown' && <div className="form-field full"><label>Options (comma separated)</label><input aria-label="User column options" value={column.options} onChange={(event) => updateUserColumn(column.id, { options: event.target.value })} /></div>}
        <div className="form-field"><button type="button" className="quiet-button" onClick={() => setUserColumns((current) => current.filter((item) => item.id !== column.id))}><Trash2 /> Remove</button></div>
      </div>)}
      <button type="button" className="secondary-button" onClick={addUserColumn}><Plus /> Add new column</button>
    </section>

    <section className="card card-pad" style={{ marginTop: 16 }}>
      <div className="kicker">04 · Reporting &amp; notification flow</div>
      <div className="section-head" style={{ padding: '0 0 14px' }}><div><h2>Set this workbook's flow</h2><p>The lowest role sees only their own columns; each role above sees every column below it. Completion notices go to the next step up and head office.</p></div><GitBranch color="#6b6265" /></div>
      <ReportingFlowEditor value={flowRoleCodes} onChange={setFlowRoleCodes} roles={data?.roles ?? []} disabled={pending} emptyHint="No flow set. Select people below and their roles will be added here." />
      <div className="kicker" style={{ marginTop: 24 }}>05 · Assign work</div>
      <div className="section-head" style={{ padding: '0 0 14px' }}><div><h2>Choose who receives the leads</h2><p>Each selected person gets every saved data row and can fill their own user columns. Selecting someone adds their role to the flow automatically.</p></div><UsersRound color="#6b6265" /></div>
      {assignablePeople.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 }}>{assignablePeople.map((person) => { const order = assigneeIds.indexOf(person.id); const selected = order >= 0; return <label key={person.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: `1px solid ${selected ? '#e7a9b2' : 'var(--border)'}`, background: selected ? '#fffafb' : '#fff', borderRadius: 10, cursor: 'pointer' }}><input type="checkbox" checked={selected} onChange={() => toggleAssignee(person.id)} /><span style={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', background: selected ? '#c8102e' : '#f3eef0', color: selected ? '#fff' : '#8a8083', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{selected ? order + 1 : '·'}</span><span><strong style={{ display: 'block', fontSize: 12 }}>{person.full_name}</strong><span className="form-hint">{roleLabels.get(person.role_code) ?? person.role_code}</span></span>{selected && <Check size={15} style={{ marginLeft: 'auto', color: '#c8102e' }} />}</label>})}</div> : <p className="form-hint">No active assignees yet. You can assign this workbook later from its detail page.</p>}
      {selectedPeople.length ? <div className="notice" style={{ marginTop: 14 }}><UsersRound /> <span><strong>Hand-off chain:</strong> {selectedPeople.map((person, index) => <span key={person.id}>{index > 0 ? ' → ' : ' '}{person.full_name} ({roleLabels.get(person.role_code) ?? person.role_code}{flowRoleCodes.indexOf(person.role_code) >= 0 ? ` · level ${flowRoleCodes.indexOf(person.role_code) + 1}` : ''})</span>)}</span></div> : assignablePeople.length ? <p className="form-hint" style={{ marginTop: 12 }}>Select at least one person so the imported leads are moved to them.</p> : <p className="form-hint" style={{ marginTop: 12 }}>No active assignees yet. Create the workbook and assign it later from its detail page.</p>}
    </section>

    <div className="form-actions"><Link className="secondary-button" href="/admin/workbooks">Cancel</Link><button className="primary-button" disabled={pending || !categories.length || !dataRows.length || (assignablePeople.length > 0 && !assigneeIds.length)}>{pending ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{pending ? 'Importing…' : `Create workbook${dataRows.length ? ` · ${dataRows.length} rows` : ''}`}</button></div>
  </form>
}
