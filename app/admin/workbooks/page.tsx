'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import * as XLSX from 'xlsx'
import { ArrowRight, Download, FileSpreadsheet, Flag, LoaderCircle, Plus, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

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
  const filtered = useMemo(() => (workbooks ?? []).filter((workbook) => (status === 'all' || workbook.status === status) && workbook.name.toLowerCase().includes(search.toLowerCase())), [workbooks, status, search])

  async function togglePriority(workbook: WorkbookRow) {
    const response = await fetch(`/api/workbooks/${workbook.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_prioritized: !workbook.is_prioritized }) })
    if (!response.ok) setMessage('Priority could not be updated.')
    else { setMessage('Priority updated.'); await mutate() }
  }

  function downloadSummary() {
    const rows = filtered.map((workbook) => ({ Workbook: workbook.name, Category: workbook.categories?.name ?? '', Template: workbook.templates?.name ?? '', Status: workbook.status, Priority: workbook.is_prioritized ? 'Yes' : 'No', Leads: workbook.lead_records?.[0]?.count ?? 0, Created: new Date(workbook.created_at).toISOString() }))
    const sheet = XLSX.utils.json_to_sheet(rows)
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Workbooks')
    XLSX.writeFile(book, 'northstar-workbooks.xlsx')
  }

  return <>
    <div className="page-heading"><div><div className="kicker">Lead operations</div><h1>Workbooks</h1><p>Manage active lead sets, assignments, and completed work.</p></div><Link className="primary-button" href="/admin/workbooks/new"><Plus /> New workbook</Link></div>
    {message && <div className="notice" role="status">{message}</div>}
    <section className="card section-card" style={{ marginTop: 0 }}>
      <div className="toolbar-row"><div className="toolbar-actions"><div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 11, top: 10, color: '#8493a0' }} /><input className="toolbar-search" style={{ paddingLeft: 34 }} aria-label="Search workbooks" placeholder="Search workbooks" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="segmented" aria-label="Filter workbook status">{['all', 'active', 'ongoing', 'closed'].map((item) => <button key={item} type="button" data-active={status === item} onClick={() => setStatus(item)}>{item === 'all' ? 'All' : item[0].toUpperCase() + item.slice(1)}</button>)}</div></div><button className="secondary-button" onClick={downloadSummary} disabled={!filtered.length}><Download /> Export list</button></div>
      {isLoading ? <div className="empty-state"><LoaderCircle className="animate-spin" /></div> : error ? <div className="empty-state"><h3>Could not load workbooks</h3><p>Check your Supabase connection and refresh the page.</p></div> : !filtered.length ? <div className="empty-state"><span className="empty-icon"><FileSpreadsheet /></span><h3>{workbooks?.length ? 'No matching workbooks' : 'No workbooks yet'}</h3><p>{workbooks?.length ? 'Try another search or status filter.' : 'Create a workbook from a reusable template to add real lead data.'}</p>{!workbooks?.length && <Link className="secondary-button" style={{ marginTop: 14 }} href="/admin/workbooks/new"><Plus /> Create a workbook</Link>}</div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Workbook</th><th>Category</th><th>Template</th><th>Records</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{filtered.map((workbook) => <tr key={workbook.id}><td><Link href={`/admin/workbooks/${workbook.id}`} style={{ color: '#203b51', fontWeight: 650 }}>{workbook.name}</Link></td><td>{workbook.categories?.name ?? '—'}</td><td>{workbook.templates?.name ?? '—'}</td><td>{workbook.lead_records?.[0]?.count ?? 0}</td><td><span className="status-pill" data-tone={workbook.status === 'closed' ? 'neutral' : workbook.status === 'ongoing' ? 'amber' : undefined}><span className="status-dot" />{workbook.status}</span></td><td>{new Date(workbook.created_at).toLocaleDateString()}</td><td><div style={{ display: 'flex', gap: 3 }}><Link className="quiet-button" href={`/admin/workbooks/${workbook.id}`}>Open <ArrowRight /></Link><button className="quiet-button" aria-label={`${workbook.is_prioritized ? 'Remove priority from' : 'Prioritize'} ${workbook.name}`} onClick={() => togglePriority(workbook)}><Flag />{workbook.is_prioritized ? 'Prioritized' : 'Priority'}</button></div></td></tr>)}</tbody></table></div>}
    </section>
  </>
}
