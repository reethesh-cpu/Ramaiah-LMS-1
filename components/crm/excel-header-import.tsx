'use client'

import { ChangeEvent, useState } from 'react'
import * as XLSX from 'xlsx'
import { LoaderCircle, Upload, X } from 'lucide-react'

type MergeRange = { s: { r: number; c: number }; e: { r: number; c: number } }
type ParsedSheet = { rows: string[][]; merges: MergeRange[]; maxHeaderRows: number }

// Excel often puts a group name in a merged cell above the real column labels.
// Copy that anchor value into each covered column so both rows can be combined.
function valueAt(rows: string[][], merges: MergeRange[], row: number, column: number): string {
  const direct = String(rows[row]?.[column] ?? '').trim()
  if (direct) return direct
  const merge = merges.find((range) => row >= range.s.r && row <= range.e.r && column >= range.s.c && column <= range.e.c)
  if (!merge) return ''
  return String(rows[merge.s.r]?.[merge.s.c] ?? '').trim()
}

function buildLabels(rows: string[][], merges: MergeRange[], headerRows: number): string[] {
  const maxColumns = rows.slice(0, headerRows).reduce((max, row) => Math.max(max, row.length), 0)
  const labels: string[] = []
  const seen = new Set<string>()
  for (let column = 0; column < maxColumns; column++) {
    const parts: string[] = []
    for (let row = 0; row < headerRows; row++) {
      const value = valueAt(rows, merges, row, column)
      if (value && !parts.includes(value)) parts.push(value)
    }
    const label = parts.join(' · ')
    if (label && !seen.has(label)) { seen.add(label); labels.push(label) }
  }
  return labels
}

type ImporterPerson = { id: string; full_name: string; role_code: string; is_active: boolean }

export function ExcelHeaderImport({ people, roleLabels, onImport, onCancel, saving }: {
  people: ImporterPerson[]
  roleLabels: Map<string, string>
  onImport: (labels: string[], mode: 'source' | 'user', ownerProfileId: string) => void
  onCancel: () => void
  saving: boolean
}) {
  const [parsed, setParsed] = useState<ParsedSheet | null>(null)
  const [fileName, setFileName] = useState('')
  const [mode, setMode] = useState<'source' | 'user'>('source')
  const [ownerProfileId, setOwnerProfileId] = useState('')
  const [headerRows, setHeaderRows] = useState(1)
  const [labels, setLabels] = useState<string[]>([])
  const [selected, setSelected] = useState<boolean[]>([])
  const [error, setError] = useState('')

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    try {
      const bytes = await file.arrayBuffer()
      const workbook = XLSX.read(bytes, { type: 'array', cellDates: false })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      if (!sheet) throw new Error('The file does not contain a worksheet.')
      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false }) as string[][]
      if (!rows.length) throw new Error('The worksheet is empty.')
      const merges = (sheet['!merges'] ?? []) as MergeRange[]
      const nextParsed = { rows, merges, maxHeaderRows: Math.min(10, rows.length) }
      const initial = buildLabels(rows, merges, 1)
      setParsed(nextParsed); setFileName(file.name); setHeaderRows(1)
      setLabels(initial); setSelected(initial.map(() => true))
    } catch (caught) {
      setParsed(null); setLabels([]); setSelected([]); setFileName('')
      setError(caught instanceof Error ? caught.message : 'The file could not be read.')
    }
  }

  function changeHeaderRows(count: number) {
    setHeaderRows(count)
    if (!parsed) return
    const next = buildLabels(parsed.rows, parsed.merges, count)
    setLabels(next); setSelected(next.map(() => true))
  }

  function updateLabel(index: number, value: string) {
    setLabels((current) => current.map((label, position) => position === index ? value : label))
  }

  function toggle(index: number) {
    setSelected((current) => current.map((value, position) => position === index ? !value : value))
  }

  function submit() {
    const chosen = labels.filter((_, index) => selected[index]).map((label) => label.trim()).filter(Boolean)
    if (!chosen.length) { setError('Select at least one header to import.'); return }
    if (mode === 'user' && !ownerProfileId) { setError('Choose who will own these user columns.'); return }
    onImport(chosen, mode, ownerProfileId)
  }

  return <form className="card-pad" style={{ borderTop: '1px solid var(--border)', background: '#fffafb' }} onSubmit={(event) => { event.preventDefault(); submit() }}>
    <div className="form-grid">
      <div className="form-field full">
        <label htmlFor="excel-header-file">Excel / CSV file</label>
        <input id="excel-header-file" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void readFile(event)} />
        <span className="form-hint">The first sheet is read. Merged cells and multiple header rows are supported.</span>
      </div>
      <div className="form-field"><label htmlFor="excel-import-mode">Import as</label><select id="excel-import-mode" value={mode} onChange={(event) => setMode(event.target.value as 'source' | 'user')}><option value="source">Source headers (read-only from the file)</option><option value="user">User columns (filled in by a person)</option></select></div>
      {mode === 'user' && <div className="form-field"><label htmlFor="excel-import-owner">Column owner</label><select id="excel-import-owner" value={ownerProfileId} onChange={(event) => setOwnerProfileId(event.target.value)} required><option value="" disabled>Select a person</option>{people.map((person) => <option key={person.id} value={person.id}>{person.full_name} · {roleLabels.get(person.role_code) ?? person.role_code}</option>)}</select><span className="form-hint">These columns are created only in this template.</span></div>}
      {parsed && <div className="form-field"><label htmlFor="excel-header-rows">Header rows</label><select id="excel-header-rows" value={headerRows} onChange={(event) => changeHeaderRows(Number(event.target.value))}>{Array.from({ length: parsed.maxHeaderRows }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count === 1 ? 'Row 1 only' : `Rows 1–${count}`}</option>)}</select><span className="form-hint">Choose whether row 2, 3, or 4 is also a header. Selected rows are joined into one label.</span></div>}
    </div>
    {error && <div className="notice" data-tone="error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    {parsed && <div style={{ marginTop: 16 }}><div className="section-head" style={{ padding: '0 0 10px' }}><div><h2>Headers found in {fileName}</h2><p>Uncheck any column you do not want, or edit a label before importing.</p></div><span className="status-pill">{labels.length} columns</span></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Import</th><th>Excel column</th><th>Header label</th></tr></thead><tbody>{labels.map((label, index) => <tr key={`${index}-${label}`}><td><input type="checkbox" aria-label={`Import ${label}`} checked={selected[index]} onChange={() => toggle(index)} /></td><td style={{ fontWeight: 650 }}>{XLSX.utils.encode_col(index)}</td><td><input aria-label={`Header label for column ${XLSX.utils.encode_col(index)}`} value={label} onChange={(event) => updateLabel(index, event.target.value)} style={{ minWidth: 260 }} /></td></tr>)}</tbody></table></div>
    </div>}
    <div className="form-actions"><button type="button" className="secondary-button" onClick={onCancel}><X /> Cancel</button><button className="primary-button" disabled={saving || !parsed}>{saving ? <LoaderCircle className="animate-spin" /> : <Upload />} Import {mode === 'source' ? 'headers' : 'columns'}</button></div>
  </form>
}
