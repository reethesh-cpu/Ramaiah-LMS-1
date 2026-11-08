'use client'

import { DragEvent, FormEvent, useMemo, useState } from 'react'
import useSWR from 'swr'
import { ArrowDown, ArrowUp, GripVertical, Layers3, LoaderCircle, Plus, Save } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Role = { role_code: string; label: string }
type Category = { id: string; name: string }
type Field = { id: string; template_id: string; field_key: string; label: string; field_kind: 'source' | 'user'; owner_role_code: string | null; input_type: string; options: string[]; is_required: boolean; sort_order: number }
type Template = { id: string; name: string; description: string | null; category_id: string | null; created_at: string }
const supabase = createClient()

async function loadTemplateData() {
  const [templatesResult, fieldsResult, rolesResult, categoriesResult] = await Promise.all([
    supabase.from('templates').select('id,name,description,category_id,created_at').order('name'),
    supabase.from('template_fields').select('id,template_id,field_key,label,field_kind,owner_role_code,input_type,options,is_required,sort_order').order('sort_order'),
    supabase.from('role_definitions').select('role_code,label').order('label'),
    supabase.from('categories').select('id,name').eq('is_active', true).order('name'),
  ])
  if (templatesResult.error || fieldsResult.error || rolesResult.error || categoriesResult.error) throw new Error('Template setup could not be loaded.')
  return { templates: (templatesResult.data ?? []) as Template[], fields: (fieldsResult.data ?? []) as Field[], roles: (rolesResult.data ?? []) as Role[], categories: (categoriesResult.data ?? []) as Category[] }
}

function keyFromLabel(label: string) {
  return label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
}

export default function TemplatesPage() {
  const { data, error, isLoading, mutate } = useSWR('admin-template-data', loadTemplateData)
  const [selectedId, setSelectedId] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showField, setShowField] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState('')
  const [dragId, setDragId] = useState('')
  const templates = data?.templates ?? []
  const currentId = selectedId || templates[0]?.id || ''
  const currentTemplate = templates.find((template) => template.id === currentId)
  const fields = useMemo(() => (data?.fields ?? []).filter((field) => field.template_id === currentId).sort((a, b) => a.sort_order - b.sort_order), [data?.fields, currentId])
  const categoryName = data?.categories.find((category) => category.id === currentTemplate?.category_id)?.name

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setFormError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: template, error: insertError } = await supabase.from('templates').insert({ name: String(form.get('name')).trim(), description: String(form.get('description') ?? '').trim() || null, category_id: String(form.get('category_id') ?? '') || null, created_by: user?.id }).select('id').single()
    if (insertError || !template) setFormError('Template could not be created. Check that the name is unique for this category.')
    else { setMessage('Template created. Add the source and user fields it should contain.'); setSelectedId(template.id); setShowCreate(false); await mutate() }
    setSaving(false)
  }

  async function addField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setFormError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    const label = String(form.get('label') ?? '').trim()
    const fieldKey = keyFromLabel(label)
    const kind = String(form.get('field_kind')) as 'source' | 'user'
    const inputType = String(form.get('input_type'))
    const roleCode = String(form.get('owner_role_code') ?? '') || null
    const options = inputType === 'dropdown' ? String(form.get('options') ?? '').split('\n').map((value) => value.trim()).filter(Boolean) : []
    if (!fieldKey) { setFormError('Use a field label containing letters or numbers.'); setSaving(false); return }
    if (kind === 'user' && !roleCode) { setFormError('Choose the role that owns this field.'); setSaving(false); return }
    if (inputType === 'dropdown' && !options.length) { setFormError('Add at least one dropdown option.'); setSaving(false); return }
    const { error: insertError } = await supabase.from('template_fields').insert({ template_id: currentId, field_key: fieldKey, label, field_kind: kind, owner_role_code: kind === 'user' ? roleCode : null, input_type: inputType, options, is_required: form.get('is_required') === 'on', sort_order: fields.length })
    if (insertError) setFormError('Field could not be added. Field keys must be unique in this template.')
    else { setMessage('Field added to the template.'); event.currentTarget.reset(); setShowField(false); await mutate() }
    setSaving(false)
  }

  async function saveOrder(nextFields: Field[]) {
    setSaving(true); setFormError('')
    const results = await Promise.all(nextFields.map((field, index) => supabase.from('template_fields').update({ sort_order: index }).eq('id', field.id)))
    if (results.some((result) => result.error)) setFormError('The field order could not be saved.')
    else { setMessage('Template field order saved.'); await mutate() }
    setSaving(false)
  }

  function moveField(index: number, targetIndex: number) {
    if (targetIndex < 0 || targetIndex >= fields.length) return
    const next = [...fields]
    const [item] = next.splice(index, 1)
    next.splice(targetIndex, 0, item)
    void saveOrder(next)
  }

  function dropField(event: DragEvent<HTMLDivElement>, targetId: string) {
    event.preventDefault()
    const sourceIndex = fields.findIndex((field) => field.id === dragId)
    const targetIndex = fields.findIndex((field) => field.id === targetId)
    setDragId('')
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return
    const next = [...fields]
    const [item] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, item)
    void saveOrder(next)
  }

  return <>
    <div className="page-heading"><div><div className="kicker">Flexible data structure</div><h1>Templates & fields</h1><p>Design reusable source headers and role-specific input columns.</p></div><button className="primary-button" type="button" onClick={() => setShowCreate((value) => !value)}><Plus /> New template</button></div>
    {(message || formError || error) && <div className="notice" data-tone={formError || error ? 'error' : undefined} role={formError || error ? 'alert' : 'status'}>{formError || error?.message || message}</div>}
    {showCreate && <section className="card card-pad" style={{ marginBottom: 18 }}><form onSubmit={createTemplate}><div className="form-grid"><div className="form-field"><label htmlFor="template-name">Template name</label><input id="template-name" name="name" required maxLength={100} /></div><div className="form-field"><label htmlFor="template-category">Category</label><select id="template-category" name="category_id" defaultValue=""><option value="">Available to all categories</option>{data?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div><div className="form-field full"><label htmlFor="template-description">Description</label><input id="template-description" name="description" maxLength={240} /></div></div><div className="form-actions"><button className="secondary-button" type="button" onClick={() => setShowCreate(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Plus />} Create template</button></div></form></section>}
    <section className="card section-card" style={{ marginTop: 0 }}>
      <div className="section-head"><div><h2>Workbook templates</h2><p>Choose a template to edit and preview its full header layout.</p></div><div className="toolbar-actions">{templates.length > 0 && <select aria-label="Select template" value={currentId} onChange={(event) => { setSelectedId(event.target.value); setMessage(''); setFormError('') }} style={{ minHeight: 36, border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', background: '#fff', color: '#304358', fontSize: 12 }}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>}</div></div>
      {isLoading ? <div className="empty-state"><LoaderCircle className="animate-spin" /></div> : !templates.length ? <div className="empty-state"><span className="empty-icon"><Layers3 /></span><h3>No templates yet</h3><p>Create a template, then add the source headers and role-specific columns your team needs.</p><button className="secondary-button" style={{ marginTop: 15 }} onClick={() => setShowCreate(true)}><Plus /> Create a template</button></div> : <>
        <div className="toolbar-row"><div><strong>{currentTemplate?.name}</strong><span className="form-hint" style={{ marginLeft: 9 }}>{categoryName ?? 'All categories'} · {fields.length} fields</span></div><button className="secondary-button" onClick={() => setShowField((value) => !value)}><Plus /> Add field</button></div>
        {showField && <form onSubmit={addField} className="card-pad" style={{ borderTop: '1px solid var(--border)', background: '#fbfcfd' }}><div className="form-grid"><div className="form-field"><label htmlFor="field-label">Column label</label><input id="field-label" name="label" required maxLength={80} placeholder="e.g. Contact outcome" /></div><div className="form-field"><label htmlFor="field-kind">Column group</label><select id="field-kind" name="field_kind" defaultValue="source"><option value="source">Uploaded lead data</option><option value="user">Assigned user input</option></select></div><div className="form-field"><label htmlFor="field-role">Owner role (for user input)</label><select id="field-role" name="owner_role_code" defaultValue=""><option value="">Select role</option>{data?.roles.map((role) => <option value={role.role_code} key={role.role_code}>{role.label}</option>)}</select></div><div className="form-field"><label htmlFor="input-type">Input type</label><select id="input-type" name="input_type" defaultValue="text"><option value="text">Free text</option><option value="textarea">Long text</option><option value="number">Number</option><option value="date">Date</option><option value="dropdown">Dropdown</option></select></div><div className="form-field full"><label htmlFor="field-options">Dropdown options</label><textarea id="field-options" name="options" placeholder={'One option per line\nContacted\nFollow-up required'} /><span className="form-hint">Only used when Input type is Dropdown.</span></div><label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#394b60', fontSize: 12 }}><input type="checkbox" name="is_required" /> Required before completion</label></div><div className="form-actions"><button className="secondary-button" type="button" onClick={() => setShowField(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Plus />} Add column</button></div></form>}
        {fields.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Order</th><th>Column</th><th>Key</th><th>Group</th><th>Owner / input</th><th>Required</th></tr></thead><tbody>{fields.map((field, index) => <tr key={field.id} draggable onDragStart={() => setDragId(field.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropField(event, field.id)}><td><div style={{ display: 'flex', alignItems: 'center', gap: 3 }}><GripVertical size={15} color="#9ba8b4" /><button className="quiet-button" style={{ padding: '4px' }} aria-label={`Move ${field.label} up`} disabled={index === 0 || saving} onClick={() => moveField(index, index - 1)}><ArrowUp /></button><button className="quiet-button" style={{ padding: '4px' }} aria-label={`Move ${field.label} down`} disabled={index === fields.length - 1 || saving} onClick={() => moveField(index, index + 1)}><ArrowDown /></button></div></td><td style={{ fontWeight: 650 }}>{field.label}</td><td><code>{field.field_key}</code></td><td>{field.field_kind === 'source' ? 'Uploaded data' : 'User input'}</td><td>{field.field_kind === 'user' ? data?.roles.find((role) => role.role_code === field.owner_role_code)?.label : 'File mapping'} · {field.input_type}</td><td>{field.is_required ? 'Required' : 'Optional'}</td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>This template has no fields</h3><p>Add the source headers to map imported files and the role-specific fields that assignees can edit.</p></div>}
        <div className="notice" style={{ margin: 16 }}>Uploaded source columns are read-only for assignees. Each user can edit only the fields assigned to their role.</div>
      </>}
    </section>
  </>
}
