'use client'

import useSWR from 'swr'
import * as XLSX from 'xlsx'
import { BarChart3, Download, FileSpreadsheet, LoaderCircle, UsersRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

async function loadReport() {
  const [workbooks, leads, assignments, profiles, notifications] = await Promise.all([
    supabase.from('workbooks').select('id,name,status,is_prioritized,created_at,categories(name),templates(name),lead_records(count)').order('created_at', { ascending: false }),
    supabase.from('lead_records').select('id,workbook_id,row_number,source_values').order('row_number'),
    supabase.from('lead_assignments').select('id,lead_id,assigned_to,role_code,status,assigned_at,completed_at,assignment_field_values(field_id,value,updated_at)').order('assigned_at'),
    supabase.from('profiles').select('id,full_name,role_code'),
    supabase.from('notification_outbox').select('id,delivery_status,created_at'),
  ])
  if (workbooks.error || leads.error || assignments.error || profiles.error || notifications.error) throw new Error('Report data could not be loaded.')
  return { workbooks: workbooks.data ?? [], leads: leads.data ?? [], assignments: assignments.data ?? [], profiles: profiles.data ?? [], notifications: notifications.data ?? [] }
}

export default function ReportsPage() {
  const { data, error, isLoading } = useSWR('admin-report-data', loadReport)
  const workbookRows = data?.workbooks ?? []
  const leadCount = data?.leads.length ?? 0
  const assigned = data?.assignments.filter((item) => item.status === 'assigned').length ?? 0
  const completed = data?.assignments.filter((item) => item.status === 'completed').length ?? 0
  const profileNames = new Map((data?.profiles ?? []).map((person) => [person.id, person.full_name]))
  const leadById = new Map((data?.leads ?? []).map((lead) => [lead.id, lead]))

  function downloadReport() {
    if (!data) return
    const workbookSheet = data.workbooks.map((item) => ({ Workbook: item.name, Category: (item.categories as { name?: string } | null)?.name ?? '', Template: (item.templates as { name?: string } | null)?.name ?? '', Status: item.status, Priority: item.is_prioritized ? 'Yes' : 'No', Records: (item.lead_records as Array<{ count: number }> | undefined)?.[0]?.count ?? 0, Created: new Date(item.created_at).toISOString() }))
    const leadSheet = data.leads.map((lead) => ({ Workbook: workbookRows.find((item) => item.id === lead.workbook_id)?.name ?? '', Row: lead.row_number, ...(lead.source_values as Record<string, string | number | boolean>) }))
    const assignmentSheet = data.assignments.map((item) => {
      const lead = leadById.get(item.lead_id)
      const fieldValues = (item.assignment_field_values as Array<{ field_id: string; value: unknown }> | undefined) ?? []
      return { Workbook: workbookRows.find((workbook) => workbook.id === lead?.workbook_id)?.name ?? '', Row: lead?.row_number ?? '', Assignee: profileNames.get(item.assigned_to) ?? '', Role: item.role_code, Status: item.status, Assigned: new Date(item.assigned_at).toISOString(), Completed: item.completed_at ?? '', ...Object.fromEntries(fieldValues.map((value) => [value.field_id, value.value])) }
    })
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(workbookSheet), 'Workbooks')
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(leadSheet), 'Leads')
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(assignmentSheet), 'Assignments')
    XLSX.writeFile(book, 'ramaiah-capital-crm-report.xlsx')
  }

  return <>
    <div className="page-heading"><div><div className="kicker">Performance & exports</div><h1>Reports</h1><p>Download a workbook-level report with source data and assignment activity.</p></div><button className="primary-button" onClick={downloadReport} disabled={!data}><Download /> Download Excel report</button></div>
    {error && <div className="notice" data-tone="error" role="alert">{error.message}</div>}
    {isLoading ? <div className="empty-state"><LoaderCircle className="animate-spin" /></div> : <>
      <section className="stat-grid"><article className="card stat-card"><div className="stat-top">Workbooks<span className="stat-icon"><FileSpreadsheet /></span></div><div className="stat-value">{workbookRows.length}</div><div className="form-hint">Across active, ongoing, and closed</div></article><article className="card stat-card"><div className="stat-top">Lead records<span className="stat-icon"><BarChart3 /></span></div><div className="stat-value">{leadCount}</div><div className="form-hint">Imported source rows</div></article><article className="card stat-card"><div className="stat-top">Open assignments<span className="stat-icon"><UsersRound /></span></div><div className="stat-value">{assigned}</div><div className="form-hint">Work currently assigned</div></article><article className="card stat-card"><div className="stat-top">Completed assignments<span className="stat-icon"><BarChart3 /></span></div><div className="stat-value">{completed}</div><div className="form-hint">Submitted by team members</div></article></section>
      <section className="card section-card"><div className="section-head"><div><h2>Workbook report preview</h2><p>{data?.notifications.length ?? 0} assignment email notices recorded in the Supabase outbox.</p></div><span className="status-pill" data-tone="amber"><span className="status-dot" />Google Mail API sender not connected</span></div>{workbookRows.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Workbook</th><th>Category</th><th>Status</th><th>Leads</th><th>Priority</th></tr></thead><tbody>{workbookRows.slice(0, 12).map((item) => <tr key={item.id}><td style={{ fontWeight: 650 }}>{item.name}</td><td>{(item.categories as { name?: string } | null)?.name ?? '—'}</td><td>{item.status}</td><td>{(item.lead_records as Array<{ count: number }> | undefined)?.[0]?.count ?? 0}</td><td>{item.is_prioritized ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><BarChart3 /></span><h3>No report data yet</h3><p>Once you create workbooks and assign lead records, their real activity will appear here.</p></div>}</section>
    </>}
  </>
}
