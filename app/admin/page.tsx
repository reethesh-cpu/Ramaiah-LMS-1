import Link from 'next/link'
import { ArrowRight, BriefcaseBusiness, CircleCheck, FileSpreadsheet, UsersRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

function StatCard({ label, value, detail, icon: Icon }: { label: string; value: number; detail: string; icon: React.ComponentType<{ size?: number }> }) {
  return <article className="card stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={16} /></span></div><div className="stat-value">{value.toLocaleString()}</div><div className="form-hint">{detail}</div></article>
}

export default async function AdminOverviewPage() {
  const supabase = await createClient()
  const [workbooks, activeWorkbooks, people, leads, recent] = await Promise.all([
    supabase.from('workbooks').select('id', { count: 'exact', head: true }),
    supabase.from('workbooks').select('id', { count: 'exact', head: true }).neq('status', 'closed'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('lead_records').select('id', { count: 'exact', head: true }),
    supabase.from('workbooks').select('id,name,status,is_prioritized,created_at,categories(name),templates(name),lead_records(count)').order('created_at', { ascending: false }).limit(6),
  ])

  const rows = (recent.data ?? []) as unknown as Array<{ id: string; name: string; status: string; is_prioritized: boolean; created_at: string; categories: { name: string } | null; templates: { name: string } | null; lead_records: Array<{ count: number }> }>
  return <>
    <div className="page-heading"><div><div className="kicker">Operations overview</div><h1>Good work starts with clarity.</h1><p>Your lead activity, team, and workbooks in one place.</p></div><Link className="primary-button" href="/admin/workbooks/new"><FileSpreadsheet /> Create workbook</Link></div>
    <section className="stat-grid" aria-label="Workspace totals">
      <StatCard label="Total workbooks" value={workbooks.count ?? 0} detail="Across all categories" icon={BriefcaseBusiness} />
      <StatCard label="Open workbooks" value={activeWorkbooks.count ?? 0} detail="Active and in progress" icon={FileSpreadsheet} />
      <StatCard label="People" value={people.count ?? 0} detail="Active and inactive profiles" icon={UsersRound} />
      <StatCard label="Lead records" value={leads.count ?? 0} detail="Uploaded to your workspace" icon={CircleCheck} />
    </section>
    <section className="card section-card">
      <div className="section-head"><div><h2>Recently created workbooks</h2><p>Newly uploaded lead work, ready for your team.</p></div><Link className="quiet-button" href="/admin/workbooks">View all <ArrowRight /></Link></div>
      {rows.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Workbook</th><th>Category</th><th>Template</th><th>Leads</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><Link href={`/admin/workbooks/${row.id}`} style={{ fontWeight: 650, color: '#231f20' }}>{row.name}</Link>{row.is_prioritized ? <span style={{ marginLeft: 8, color: '#a3231a' }}>Priority</span> : null}</td><td>{row.categories?.name ?? '—'}</td><td>{row.templates?.name ?? '—'}</td><td>{row.lead_records?.[0]?.count ?? 0}</td><td><span className="status-pill" data-tone={row.status === 'closed' ? 'neutral' : undefined}><span className="status-dot" />{row.status}</span></td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><FileSpreadsheet /></span><h3>No workbooks yet</h3><p>Create a workbook from a template and upload your first lead file. Your real Supabase data will appear here.</p><Link className="secondary-button" href="/admin/workbooks/new" style={{ marginTop: 15 }}>Create a workbook <ArrowRight /></Link></div>}
    </section>
  </>
}
