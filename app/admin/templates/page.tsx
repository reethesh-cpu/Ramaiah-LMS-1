'use client'

import Link from 'next/link'
import { DragEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { ArrowDown, ArrowUp, Columns3, GitBranch, GripVertical, Layers3, LoaderCircle, Plus, Save } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ReportingFlowEditor } from '@/components/crm/reporting-flow-editor'

type Category = { id: string; name: string }
type Field = { id: string; template_id: string; field_key: string; label: string; field_kind: 'source' | 'user'; input_type: string; options: string[]; is_required: boolean; sort_order: number }
type Template = { id: string; name: string; description: string | null; category_id: string | null; created_at: string }
type Role = { role_code: string; label: string }
type Step = { template_id: string; role_code: string; step_order: number }
const supabase = createClient()

async function loadTemplateData() {
  const [templatesResult, fieldsResult, categoriesResult, rolesResult, stepsResult] = await Promise.all([
    supabase.from('templates').select('id,name,description,category_id,created_at').order('name'),
    supabase.from('template_fields').select('id,template_id,field_key,label,field_kind,input_type,options,is_required,sort_order').order('sort_order'),
    supabase.from('categories').select('id,name').eq('is_active', true).order('name'),
    supabase.from('role_definitions').select('role_code,label').order('label'),
    supabase.from('template_reporting_steps').select('template_id,role_code,step_order').order('step_order'),
  ])
  if (templatesResult.error || fieldsResult.error || categoriesResult.error || rolesResult.error) throw new Error('Template setup could not be loaded.')
  return {
    templates: (templatesResult.data ?? []) as Template[],
    fields: (fieldsResult.data ?? []) as Field[],
    categories: (categoriesResult.data ?? []) as Category[],
    roles: (rolesResult.data ?? []) as Role[],
    steps: (stepsResult.data ?? []) as Step[],
    flowReady: !stepsResult.error,
  }
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
  const [flowDraft, setFlowDraft] = useState<string[]>([])
  const templates = data?.templates ?? []
  const currentId = selectedId || templates[0]?.id || ''
  const currentTemplate = templates.find((template) => template.id === currentId)
  const fields = useMemo(() => (data?.fields ?? []).filter((field) => field.template_id === currentId), [data?.fields, currentId])
  const sourceFields = useMemo(() => fields.filter((field) => field.field_kind === 'source').sort((a, b) => a.sort_order - b.sort_order), [fields])
  const userColumnCount = fields.length - sourceFields.length
  const categoryName = data?.categories.find((category) => category.id === currentTemplate?.category_id)?.name

  const savedFlowKey = useMemo(() => (data?.steps ?? [])
    .filter((step) => step.template_id === currentId)
    .sort((a, b) => a.step_order - b.step_order)
    .map((step) => step.role_code)
    .join('|'), [currentId, data?.steps])

  useEffect(() => {
    setFlowDraft(savedFlowKey ? savedFlowKey.split('|') : [])
  }, [savedFlowKey])

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setFormError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: template, error: insertError } = await supabase.from('templates').insert({ name: String(form.get('name')).trim(), description: String(form.get('description') ?? '').trim() || null, category_id: String(form.get('category_id') ?? '') || null, created_by: user?.id }).select('id').single()
    if (insertError || !template) setFormError('Template could not be created. Check that the name is unique for this category.')
    else { setMessage('Template created. Add the workbook headers it should contain.'); setSelectedId(template.id); setShowCreate(false); await mutate() }
    setSaving(false)
  }

  async function addField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setFormError(''); setMessage('')
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const label = String(form.get('label') ?? '').trim()
    const fieldKey = keyFromLabel(label)
    const inputType = String(form.get('input_type'))
    const options = inputType === 'dropdown' ? String(form.get('options') ?? '').split('\n').map((value) => value.trim()).filter(Boolean) : []
    if (!fieldKey) { setFormError('Use a header label containing letters or numbers.'); setSaving(false); return }
    if (inputType === 'dropdown' && !options.length) { setFormError('Add at least one dropdown option.'); setSaving(false); return }
    const { error: insertError } = await supabase.from('template_fields').insert({ template_id: currentId, field_key: fieldKey, label, field_kind: 'source', owner_role_code: null, input_type: inputType, options, is_required: form.get('is_required') === 'on', sort_order: fields.length })
    if (insertError) setFormError('Header could not be added. Header keys must be unique in this template.')
    else { setMessage('Workbook header added.'); formElement.reset(); setShowField(false); await mutate() }
    setSaving(false)
  }

  async function saveOrder(nextFields: Field[]) {
    setSaving(true); setFormError('')
    const results = await Promise.all(nextFields.map((field, index) => supabase.from('template_fields').update({ sort_order: index }).eq('id', field.id)))
    if (results.some((result) => result.error)) setFormError('The header order could not be saved.')
    else { setMessage('Workbook header order saved.'); await mutate() }
    setSaving(false)
  }

  function moveField(index: number, targetIndex: number) {
    if (targetIndex < 0 || targetIndex >= sourceFields.length) return
    const next = [...sourceFields]
    const [item] = next.splice(index, 1)
    next.splice(targetIndex, 0, item)
    void saveOrder(next)
  }

  function dropField(event: DragEvent<HTMLDivElement>, targetId: string) {
    event.preventDefault()
    const sourceIndex = sourceFields.findIndex((field) => field.id === dragId)
    const targetIndex = sourceFields.findIndex((field) => field.id === targetId)
    setDragId('')
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return
    const next = [...sourceFields]
    const [item] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, item)
    void saveOrder(next)
  }

  async function saveFlow() {
    if (!currentId) return
    setSaving(true); setFormError(''); setMessage('')
    const { error: flowError } = await supabase.rpc('set_template_reporting_steps', { p_template_id: currentId, p_role_codes: flowDraft })
    if (flowError) setFormError('The reporting flow could not be saved. Run supabase/manual-apply/09_reporting_flow.sql in Supabase first.')
    else { setMessage('Reporting flow saved. New workbooks will copy this flow; existing workbooks keep their own until changed.'); await mutate() }
    setSaving(false)
  }

  return <>
    <div className="page-heading"><div><div className="kicker">Workbook structure</div><h1>Templates & headers</h1><p>Design reusable workbook headers and drag them into the order you need.</p></div><button className="primary-button" type="button" onClick={() => setShowCreate((value) => !value)}><Plus /> New template</button></div>
    {(message || formError || error) && <div className="notice" data-tone={formError || error ? 'error' : undefined} role={formError || error ? 'alert' : 'status'}>{formError || error?.message || message}</div>}
    {showCreate && <section className="card card-pad" style={{ marginBottom: 18 }}><form onSubmit={createTemplate}><div className="form-grid"><div className="form-field"><label htmlFor="template-name">Template name</label><input id="template-name" name="name" required maxLength={100} /></div><div className="form-field"><label htmlFor="template-category">Category</label><select id="template-category" name="category_id" defaultValue=""><option value="">Available to all categories</option>{data?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div><div className="form-field full"><label htmlFor="template-description">Description</label><input id="template-description" name="description" maxLength={240} /></div></div><div className="form-actions"><button className="secondary-button" type="button" onClick={() => setShowCreate(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Plus />} Create template</button></div></form></section>}
    <section className="card section-card" style={{ marginTop: 0 }}>
      <div className="section-head"><div><h2>Workbook templates</h2><p>Choose a template to edit and reorder its uploaded-data headers.</p></div><div className="toolbar-actions">{templates.length > 0 && <select aria-label="Select template" value={currentId} onChange={(event) => { setSelectedId(event.target.value); setMessage(''); setFormError('') }} style={{ minHeight: 36, border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', background: '#fff', color: '#3a3436', fontSize: 12 }}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>}</div></div>
      {isLoading ? <div className="empty-state"><LoaderCircle className="animate-spin" /></div> : !templates.length ? <div className="empty-state"><span className="empty-icon"><Layers3 /></span><h3>No templates yet</h3><p>Create a template, then add the workbook headers your team imports.</p><button className="secondary-button" style={{ marginTop: 15 }} onClick={() => setShowCreate(true)}><Plus /> Create a template</button></div> : <>
        <div className="toolbar-row"><div><strong>{currentTemplate?.name}</strong><span className="form-hint" style={{ marginLeft: 9 }}>{categoryName ?? 'All categories'} · {sourceFields.length} headers{userColumnCount ? ` · ${userColumnCount} user columns` : ''}</span></div><button className="secondary-button" onClick={() => setShowField((value) => !value)}><Plus /> Add header</button></div>
        {showField && <form onSubmit={addField} className="card-pad" style={{ borderTop: '1px solid var(--border)', background: '#fffafb' }}><div className="form-grid"><div className="form-field"><label htmlFor="field-label">Header label</label><input id="field-label" name="label" required maxLength={80} placeholder="e.g. Customer name" /></div><div className="form-field"><label htmlFor="input-type">Input type</label><select id="input-type" name="input_type" defaultValue="text"><option value="text">Free text</option><option value="number">Number</option><option value="date">Date</option><option value="dropdown">Dropdown</option></select></div><div className="form-field full"><label htmlFor="field-options">Dropdown options</label><textarea id="field-options" name="options" placeholder={'One option per line\nYes\nNo'} /><span className="form-hint">Only used when Input type is Dropdown.</span></div><label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4a4144', fontSize: 12 }}><input type="checkbox" name="is_required" /> Required when importing a workbook</label></div><div className="form-actions"><button className="secondary-button" type="button" onClick={() => setShowField(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Plus />} Add header</button></div></form>}
        {sourceFields.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Order</th><th>Header</th><th>Key</th><th>Input type</th><th>Required</th></tr></thead><tbody>{sourceFields.map((field, index) => <tr key={field.id} draggable onDragStart={() => setDragId(field.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropField(event, field.id)}><td><div style={{ display: 'flex', alignItems: 'center', gap: 3 }}><GripVertical size={15} color="#9a9296" /><button className="quiet-button" style={{ padding: '4px' }} aria-label={`Move ${field.label} up`} disabled={index === 0 || saving} onClick={() => moveField(index, index - 1)}><ArrowUp /></button><button className="quiet-button" style={{ padding: '4px' }} aria-label={`Move ${field.label} down`} disabled={index === sourceFields.length - 1 || saving} onClick={() => moveField(index, index + 1)}><ArrowDown /></button></div></td><td style={{ fontWeight: 650 }}>{field.label}</td><td><code>{field.field_key}</code></td><td>{field.input_type}</td><td>{field.is_required ? 'Required' : 'Optional'}</td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>This template has no headers</h3><p>Add the workbook headers that imported files will map to.</p></div>}
        <div className="card-pad" style={{ borderTop: '1px solid var(--border)', background: '#fffafb' }}>
          <div className="section-head" style={{ padding: '0 0 14px' }}>
            <div><h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}><GitBranch size={17} /> Reporting & notification flow</h3><p style={{ margin: '5px 0 0' }}>Define who is below whom for workbooks made from this template. Each step can see the columns of everyone below it, and completion notices travel to the next step up. Put the lowest role first — for example telecaller → AGM → HR → CEO → head office.</p></div>
            <button className="primary-button" type="button" onClick={() => void saveFlow()} disabled={saving || !data?.flowReady}><Save /> Save flow</button>
          </div>
          {!data?.flowReady && <div className="notice" data-tone="error" style={{ marginBottom: 12 }}>Run <code>supabase/manual-apply/09_reporting_flow.sql</code> in the Supabase SQL Editor to enable per-workbook reporting flows.</div>}
          <ReportingFlowEditor value={flowDraft} onChange={setFlowDraft} roles={data?.roles ?? []} disabled={saving || !data?.flowReady} emptyHint="No flow set yet. Until you add roles, workbooks fall back to each person's Reports to links." />
          <div className="notice" style={{ marginTop: 14 }}><GitBranch /> This is the default flow. When a workbook is created it copies this flow, and head office can adjust that workbook's flow from its detail page without changing the template.</div>
        </div>
        <div className="notice" style={{ margin: 16 }}><Columns3 /> Workbook headers are read-only for assignees. Extra columns for one person are managed globally in <Link href="/admin/user-columns" style={{ color: '#c8102e', fontWeight: 650 }}>User columns</Link>.</div>
      </>}
    </section>
  </>
}
