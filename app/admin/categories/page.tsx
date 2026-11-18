'use client'

import { FormEvent, useState } from 'react'
import useSWR from 'swr'
import { LoaderCircle, Pencil, Plus, Save, Tags, ToggleLeft, ToggleRight, Trash2, X } from 'lucide-react'
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  function resetFeedback() { setMessage(''); setFormError('') }

  function beginAdd() { resetFeedback(); setEditingId(null); setConfirmDeleteId(null); setOpen((value) => !value) }

  function beginEdit(category: Category) {
    resetFeedback(); setOpen(false); setConfirmDeleteId(null)
    setEditingId(category.id); setEditName(category.name); setEditDescription(category.description ?? '')
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); resetFeedback()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const { data: { user } } = await supabase.auth.getUser()
    const { error: insertError } = await supabase.from('categories').insert({ name: String(form.get('name')).trim(), description: String(form.get('description') ?? '').trim() || null, created_by: user?.id })
    if (insertError) setFormError('Category could not be created. Category names must be unique.')
    else { setMessage('Category added. It is available to the workbook uploader.'); formElement.reset(); setOpen(false); await mutate() }
    setPending(false)
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingId) return
    const name = editName.trim()
    if (!name) { setFormError('Enter a category name.'); return }
    setBusyId(editingId); resetFeedback()
    const { error: updateError } = await supabase.from('categories').update({ name, description: editDescription.trim() || null }).eq('id', editingId)
    if (updateError) setFormError('Category could not be updated. Category names must be unique.')
    else { setMessage(`“${name}” updated.`); setEditingId(null); await mutate() }
    setBusyId(null)
  }

  async function toggle(category: Category) {
    resetFeedback()
    const { error: updateError } = await supabase.from('categories').update({ is_active: !category.is_active }).eq('id', category.id)
    if (updateError) setFormError('Category status could not be changed.')
    else { setMessage(`${category.name} is now ${category.is_active ? 'inactive' : 'active'}.`); await mutate() }
  }

  async function deleteCategory(category: Category) {
    setBusyId(category.id); resetFeedback()
    const [templateUsage, workbookUsage] = await Promise.all([
      supabase.from('templates').select('id', { count: 'exact', head: true }).eq('category_id', category.id),
      supabase.from('workbooks').select('id', { count: 'exact', head: true }).eq('category_id', category.id),
    ])
    const templateCount = templateUsage.count ?? 0
    const workbookCount = workbookUsage.count ?? 0
    if (templateCount || workbookCount) {
      const parts = [
        templateCount ? `${templateCount} template${templateCount === 1 ? '' : 's'}` : '',
        workbookCount ? `${workbookCount} workbook${workbookCount === 1 ? '' : 's'}` : '',
      ].filter(Boolean)
      setFormError(`“${category.name}” is used by ${parts.join(' and ')}. Deactivate it instead, or move those items to another category first.`)
      setConfirmDeleteId(null); setBusyId(null); return
    }
    const { error: deleteError } = await supabase.from('categories').delete().eq('id', category.id)
    if (deleteError) setFormError('Category could not be deleted. Remove its templates and workbooks first, or deactivate it instead.')
    else { setMessage(`“${category.name}” deleted.`); setConfirmDeleteId(null); await mutate() }
    setBusyId(null)
  }

  return <>
    <div className="page-heading"><div><div className="kicker">Workbook organization</div><h1>Categories</h1><p>Keep different lead programs organized with reusable categories.</p></div><button className="primary-button" onClick={beginAdd}><Plus /> Add category</button></div>
    {(message || formError || error) && <div className="notice" data-tone={formError || error ? 'error' : undefined} role={formError || error ? 'alert' : 'status'}>{formError || error?.message || message}</div>}
    {open && <section className="card card-pad" style={{ marginBottom: 18 }}><form onSubmit={createCategory}><div className="form-grid"><div className="form-field"><label htmlFor="category-name">Category name</label><input id="category-name" name="name" maxLength={80} required /></div><div className="form-field"><label htmlFor="category-description">Description</label><input id="category-description" name="description" maxLength={240} /></div></div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <Plus />} Create category</button></div></form></section>}
    {editingId && <section className="card card-pad" style={{ marginBottom: 18 }}><form onSubmit={saveCategory}><div className="form-grid"><div className="form-field"><label htmlFor="edit-category-name">Category name</label><input id="edit-category-name" value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={80} required autoFocus /></div><div className="form-field"><label htmlFor="edit-category-description">Description</label><input id="edit-category-description" value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={240} /></div></div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setEditingId(null)}><X /> Cancel</button><button className="primary-button" disabled={busyId === editingId}>{busyId === editingId ? <LoaderCircle className="animate-spin" /> : <Save />} Save changes</button></div></form></section>}
    <section className="card section-card" style={{ marginTop: 0 }}><div className="section-head"><div><h2>All categories</h2><p>{categories?.length ?? 0} created categories</p></div></div>
      {isLoading ? <div className="empty-state"><LoaderCircle className="animate-spin" /></div> : !categories?.length ? <div className="empty-state"><span className="empty-icon"><Tags /></span><h3>No categories yet</h3><p>Add a category before creating a workbook. Categories are stored in your connected Supabase project.</p></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Category</th><th>Description</th><th>Created</th><th>Status</th><th>Actions</th></tr></thead><tbody>{categories.map((category) => <tr key={category.id}><td style={{ fontWeight: 650 }}>{category.name}</td><td>{category.description || '—'}</td><td>{new Date(category.created_at).toLocaleDateString()}</td><td><span className="status-pill" data-tone={category.is_active ? undefined : 'neutral'}><span className="status-dot" />{category.is_active ? 'Active' : 'Inactive'}</span></td><td><div className="row-actions"><button className="quiet-button" onClick={() => beginEdit(category)}><Pencil /> Edit</button>{confirmDeleteId === category.id ? <><button className="danger-button" disabled={busyId === category.id} onClick={() => void deleteCategory(category)}>{busyId === category.id ? <LoaderCircle className="animate-spin" /> : <Trash2 />} Confirm</button><button className="quiet-button" onClick={() => setConfirmDeleteId(null)}><X /> Cancel</button></> : <button className="quiet-button" onClick={() => { resetFeedback(); setEditingId(null); setConfirmDeleteId(category.id) }}><Trash2 /> Delete</button>}<button className="quiet-button" onClick={() => toggle(category)}>{category.is_active ? <ToggleRight /> : <ToggleLeft />}{category.is_active ? 'Deactivate' : 'Activate'}</button></div></td></tr>)}</tbody></table></div>}
    </section>
  </>
}
