'use client'

import { FormEvent, useState } from 'react'
import useSWR from 'swr'
import { LoaderCircle, Plus, Tags, ToggleLeft, ToggleRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Category = { id: string; name: string; description: string | null; is_active: boolean; created_at: string }
const supabase = createClient()

async function loadCategories() {
  const { data, error } = await supabase.from('categories').select('id,name,description,is_active,created_at').order('name')
  if (error) throw new Error('Categories could not be loaded.')
  return (data ?? []) as Category[]
}

export default function CategoriesPage() {
  const { data: categories, error, isLoading, mutate } = useSWR('admin-categories', loadCategories)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState('')

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage(''); setFormError('')
    const form = new FormData(event.currentTarget)
    const { data: { user } } = await supabase.auth.getUser()
    const { error: insertError } = await supabase.from('categories').insert({ name: String(form.get('name')).trim(), description: String(form.get('description') ?? '').trim() || null, created_by: user?.id })
    if (insertError) setFormError('Category could not be created. Category names must be unique.')
    else { setMessage('Category added. It is available to the workbook uploader.'); event.currentTarget.reset(); setOpen(false); await mutate() }
    setPending(false)
  }

  async function toggle(category: Category) {
    const { error: updateError } = await supabase.from('categories').update({ is_active: !category.is_active }).eq('id', category.id)
    if (updateError) setFormError('Category status could not be changed.')
    else { setMessage(`${category.name} is now ${category.is_active ? 'inactive' : 'active'}.`); await mutate() }
  }

  return <>
    <div className="page-heading"><div><div className="kicker">Workbook organization</div><h1>Categories</h1><p>Keep different lead programs organized with reusable categories.</p></div><button className="primary-button" onClick={() => setOpen((value) => !value)}><Plus /> Add category</button></div>
    {(message || formError || error) && <div className="notice" data-tone={formError || error ? 'error' : undefined} role={formError || error ? 'alert' : 'status'}>{formError || error?.message || message}</div>}
    {open && <section className="card card-pad" style={{ marginBottom: 18 }}><form onSubmit={createCategory}><div className="form-grid"><div className="form-field"><label htmlFor="category-name">Category name</label><input id="category-name" name="name" maxLength={80} required /></div><div className="form-field"><label htmlFor="category-description">Description</label><input id="category-description" name="description" maxLength={240} /></div></div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <Plus />} Create category</button></div></form></section>}
    <section className="card section-card" style={{ marginTop: 0 }}><div className="section-head"><div><h2>All categories</h2><p>{categories?.length ?? 0} created categories</p></div></div>
      {isLoading ? <div className="empty-state"><LoaderCircle className="animate-spin" /></div> : !categories?.length ? <div className="empty-state"><span className="empty-icon"><Tags /></span><h3>No categories yet</h3><p>Add a category before creating a workbook. Categories are stored in your connected Supabase project.</p></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Category</th><th>Description</th><th>Created</th><th>Status</th><th /></tr></thead><tbody>{categories.map((category) => <tr key={category.id}><td style={{ fontWeight: 650 }}>{category.name}</td><td>{category.description || '—'}</td><td>{new Date(category.created_at).toLocaleDateString()}</td><td><span className="status-pill" data-tone={category.is_active ? undefined : 'neutral'}><span className="status-dot" />{category.is_active ? 'Active' : 'Inactive'}</span></td><td><button className="quiet-button" onClick={() => toggle(category)}>{category.is_active ? <ToggleRight /> : <ToggleLeft />}{category.is_active ? 'Deactivate' : 'Activate'}</button></td></tr>)}</tbody></table></div>}
    </section>
  </>
}
