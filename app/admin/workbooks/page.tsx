'use client'

import { TransitionLink as Link } from '@/components/crm/route-transition'
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import * as XLSX from 'xlsx'
import { ArrowRight, Download, FileSpreadsheet, Flag, LoaderCircle, Plus, Search, Trash2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { WORKBOOK_STATUSES, workbookStatusLabel } from '@/lib/crm/workbook-status'

type WorkbookRow = { id: string; name: string; status: string; is_prioritized: boolean; created_at: string; categories: { name: string } | null; templates: { name: string } | null; lead_records: Array<{ count: number }> }
const supabase = createClient()

async function loadWorkbooks() {
  const { data, error } = await supabase.from('workbooks').select('id,name,status,is_prioritized,created_at,categories(name),templates(name),lead_records(count)').order('created_at', { ascending: false })
  if (error) throw new Error('Workbooks could not be loaded.')
  return (data ?? []) as unknown as WorkbookRow[]
}

export default function WorkbooksPage() {
  const { data: workbooks, error, isLoading, mutate } = useSWR('admin-workbooks', loadWorkbooks)
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState('')
  const [statusSavingId, setStatusSavingId] = useState('')
  const filtered = useMemo(() => (workbooks ?? [])
    .filter((workbook) => (status === 'all' || workbook.status === status) && workbook.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(b.is_prioritized) - Number(a.is_prioritized) || Date.parse(b.created_at) - Date.parse(a.created_at)), [workbooks, status, search])

  async function changeStatus(workbook: WorkbookRow, nextStatus: string) {
    if (nextStatus === workbook.status) return
    setStatusSavingId(workbook.id); setMessage('')
    const response = await fetch(`/api/workbooks/${workbook.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) setMessage(result.error ?? 'Status could not be updated.')
    else { setMessage(`“${workbook.name}” is now ${workbookStatusLabel(result.workbook?.status ?? nextStatus).toLowerCase()}.`); await mutate() }
    setStatusSavingId('')
  }

  async function togglePriority(workbook: WorkbookRow) {
    const response = await fetch(`/api/workbooks/${workbook.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_prioritized: !workbook.is_prioritized }) })
    if (!response.ok) setMessage('Priority could not be updated.')
    else { setMessage('Priority updated.'); await mutate() }
  }

  async function deleteWorkbook(workbook: WorkbookRow) {
    setDeletingId(workbook.id); setMessage('')
    const response = await fetch(`/api/workbooks/${workbook.id}`, { method: 'DELETE' })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) setMessage(result.error ?? 'The workbook could not be deleted.')
    else { setMessage(`“${result.name ?? workbook.name}” and its records were deleted.`); setConfirmDeleteId(null); await mutate() }
    setDeletingId('')
  }

  function downloadSummary() {
    const rows = filtered.map((workbook) => ({ Workbook: workbook.name, Category: workbook.categories?.name ?? '', Template: workbook.templates?.name ?? '', Status: workbookStatusLabel(workbook.status), Priority: workbook.is_prioritized ? 'Yes' : 'No', Leads: workbook.lead_records?.[0]?.count ?? 0, Created: new Date(workbook.created_at).toISOString() }))
    const sheet = XLSX.utils.json_to_sheet(rows)
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Workbooks')
    XLSX.writeFile(book, 'ramaiah-capital-workbooks.xlsx')
  }

  return <>
    <div className="page-heading"><div><div className="kicker">Lead operations</div><h1>Workbooks</h1><p>Manage active lead sets, assignments, and completed work.</p></div><Link className="primary-button" href="/admin/workbooks/new"><Plus /> New workbook</Link></div>
    {message && <div className="notice" role="status">{message}</div>}
    <section className="card section-card" style={{ marginTop: 0 }}>
      <div className="toolbar-row"><div className="toolbar-actions"><div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 11, top: 10, color: '#8a8083' }} /><input className="toolbar-search" style={{ paddingLeft: 34 }} aria-label="Search workbooks" placeholder="Search workbooks" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="segmented" aria-label="Filter workbook status">{[{ value: 'all', label: 'All' }, ...WORKBOOK_STATUSES].map((item) => <button key={item.value} type="button" data-active={status === item.value} onClick={() => setStatus(item.value)}>{item.label}</button>)}</div></div><button className="secondary-button" onClick={downloadSummary} disabled={!filtered.length}><Download /> Export list</button></div>
      {isLoading ? <div className="empty-state"><LoaderCircle className="animate-spin" /></div> : error ? <div className="empty-state"><h3>Could not load workbooks</h3><p>Check your Supabase connection and refresh the page.</p></div> : !filtered.length ? <div className="empty-state"><span className="empty-icon"><FileSpreadsheet /></span><h3>{workbooks?.length ? 'No matching workbooks' : 'No workbooks yet'}</h3><p>{workbooks?.length ? 'Try another search or status filter.' : 'Create a workbook from a reusable template to add real lead data.'}</p>{!workbooks?.length && <Link className="secondary-button" style={{ marginTop: 14 }} href="/admin/workbooks/new"><Plus /> Create a workbook</Link>}</div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Workbook</th><th>Category</th><th>Template</th><th>Records</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>{filtered.map((workbook) => <tr key={workbook.id} className={workbook.is_prioritized ? 'prioritized-row' : undefined}><td><Link href={`/admin/workbooks/${workbook.id}`} style={{ color: '#231f20', fontWeight: 650 }}>{workbook.name}</Link>{workbook.is_prioritized ? <span className="priority-badge"><Flag size={11} /> Priority</span> : null}</td><td>{workbook.categories?.name ?? '—'}</td><td>{workbook.templates?.name ?? '—'}</td><td>{workbook.lead_records?.[0]?.count ?? 0}</td><td><select aria-label={`Status for ${workbook.name}`} value={workbook.status === 'completed' ? 'closed' : workbook.status} disabled={statusSavingId === workbook.id} onChange={(event) => void changeStatus(workbook, event.target.value)}>{WORKBOOK_STATUSES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></td><td>{new Date(workbook.created_at).toLocaleDateString()}</td><td><div style={{ display: 'flex', gap: 3 }}><Link className="quiet-button" href={`/admin/workbooks/${workbook.id}`}>Open <ArrowRight /></Link><button className="quiet-button" aria-label={`${workbook.is_prioritized ? 'Remove priority from' : 'Prioritize'} ${workbook.name}`} onClick={() => togglePriority(workbook)}><Flag />{workbook.is_prioritized ? 'Prioritized' : 'Priority'}</button>{confirmDeleteId === workbook.id ? <><button className="danger-button" disabled={deletingId === workbook.id} aria-label={`Confirm delete ${workbook.name}`} onClick={() => void deleteWorkbook(workbook)}>{deletingId === workbook.id ? <LoaderCircle className="animate-spin" /> : <Trash2 />} Confirm</button><button className="quiet-button" aria-label={`Cancel delete ${workbook.name}`} onClick={() => setConfirmDeleteId(null)}><X /> Cancel</button></> : <button className="quiet-button" aria-label={`Delete ${workbook.name}`} onClick={() => { setMessage(''); setConfirmDeleteId(workbook.id) }}><Trash2 /> Delete</button>}</div></td></tr>)}</tbody></table></div>}
    </section>
  </>
}
