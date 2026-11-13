'use client'

import Link from 'next/link'
import { FormEvent, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Columns3, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Template = { id: string; name: string }
type Person = { id: string; full_name: string; role_code: string; is_active: boolean }
type Role = { role_code: string; label: string }
type Field = { id: string; template_id: string | null; field_key: string; label: string; field_kind: 'source' | 'user'; owner_role_code: string | null; owner_profile_id: string | null; input_type: string; options: string[]; is_required: boolean; sort_order: number }
const supabase = createClient()

const inputTypeLabels: Record<string, string> = { text: 'Free text', textarea: 'Long text', number: 'Number', date: 'Date', dropdown: 'Dropdown' }

async function loadData() {
  const [templatesResult, fieldsResult, peopleResult, rolesResult] = await Promise.all([
    supabase.from('templates').select('id,name').order('name'),
    supabase.from('template_fields').select('id,template_id,field_key,label,field_kind,owner_role_code,owner_profile_id,input_type,options,is_required,sort_order').eq('field_kind', 'user').order('label'),
    supabase.from('profiles').select('id,full_name,role_code,is_active').order('full_name'),
    supabase.from('role_definitions').select('role_code,label').order('label'),
  ])
  if (templatesResult.error || fieldsResult.error || peopleResult.error || rolesResult.error) throw new Error('User column setup could not be loaded. Run the user-columns and reporting-flow SQL migrations first.')
  return {
    templates: (templatesResult.data ?? []) as Template[],
    fields: (fieldsResult.data ?? []) as Field[],
    people: (peopleResult.data ?? []) as Person[],
    roles: (rolesResult.data ?? []) as Role[],
  }
}

function keyFromLabel(label: string) {
  return label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 70)
}

function uniqueKey(base: string, existing: Set<string>) {
  const seed = base || 'column'
  if (!existing.has(seed)) return seed
  let suffix = 2
  while (existing.has(`${seed}_${suffix}`)) suffix += 1
  return `${seed}_${suffix}`
}

export default function UserColumnsPage() {
  const { data, error, isLoading, mutate } = useSWR('admin-user-columns', loadData)
  const [ownerProfileId, setOwnerProfileId] = useState('')
  const [inputType, setInputType] = useState('text')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState('')
  const people = (data?.people ?? []).filter((person) => person.is_active && person.role_code !== 'head_office')
  const peopleById = useMemo(() => new Map((data?.people ?? []).map((person) => [person.id, person])), [data?.people])
  const roleLabels = useMemo(() => new Map((data?.roles ?? []).map((role) => [role.role_code, role.label])), [data?.roles])
  const templateNames = useMemo(() => new Map((data?.templates ?? []).map((template) => [template.id, template.name])), [data?.templates])
  const fields = useMemo(() => [...(data?.fields ?? [])].sort((a, b) => {
    const ownerA = peopleById.get(a.owner_profile_id ?? '')?.full_name ?? ''
    const ownerB = peopleById.get(b.owner_profile_id ?? '')?.full_name ?? ''
    return ownerA.localeCompare(ownerB) || a.label.localeCompare(b.label)
  }), [data?.fields, peopleById])

  function ownerLabel(field: Field) {
    if (field.owner_profile_id) return peopleById.get(field.owner_profile_id)?.full_name ?? 'Removed person'
    return roleLabels.get(field.owner_role_code ?? '') ?? field.owner_role_code ?? '—'
  }

  function scopeLabel(field: Field) {
    return field.template_id ? templateNames.get(field.template_id) ?? 'One template' : 'All templates'
  }

  async function createColumn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setFormError(''); setMessage('')
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const ownerId = String(form.get('owner_profile_id') ?? '')
    const label = String(form.get('label') ?? '').trim()
    const type = String(form.get('input_type') ?? 'text')
    const options = type === 'dropdown' ? String(form.get('options') ?? '').split('\n').map((value) => value.trim()).filter(Boolean) : []
    if (!ownerId) { setFormError('Choose the person who will own this column.'); setSaving(false); return }
    if (!label) { setFormError('Enter a column label.'); setSaving(false); return }
    if (type === 'dropdown' && !options.length) { setFormError('Add at least one dropdown option.'); setSaving(false); return }

    const globalForOwner = fields.filter((field) => field.template_id === null && field.owner_profile_id === ownerId)
    const fieldKey = uniqueKey(keyFromLabel(label), new Set(globalForOwner.map((field) => field.field_key)))
    const nextOrder = fields.reduce((max, field) => Math.max(max, field.sort_order + 1), 0)
    const { error: insertError } = await supabase.from('template_fields').insert({
      template_id: null,
      field_key: fieldKey,
      label,
      field_kind: 'user',
      owner_role_code: null,
      owner_profile_id: ownerId,
      input_type: type,
      options,
      is_required: form.get('is_required') === 'on',
      sort_order: nextOrder,
    })
    if (insertError) setFormError('The column could not be added. Make sure the reporting-flow SQL has been applied and the label is unique for this person.')
    else {
      const owner = peopleById.get(ownerId)?.full_name ?? 'the selected person'
      setMessage(`Column added for ${owner}. It now applies to every template and workbook.`)
      const labelInput = formElement.elements.namedItem('label')
      if (labelInput instanceof HTMLInputElement) labelInput.value = ''
      const optionsInput = formElement.elements.namedItem('options')
      if (optionsInput instanceof HTMLTextAreaElement) optionsInput.value = ''
      const requiredInput = formElement.elements.namedItem('is_required')
      if (requiredInput instanceof HTMLInputElement) requiredInput.checked = false
      setInputType('text')
      await mutate()
    }
    setSaving(false)
  }

  async function useEverywhere(field: Field) {
    if (!window.confirm(`Make “${field.label}” available in every template? The values already saved in it stay attached to this workbook.`)) return
    setSaving(true); setFormError(''); setMessage('')
    const { error: updateError } = await supabase.from('template_fields').update({ template_id: null }).eq('id', field.id)
    if (updateError) setFormError('This column could not be made global. This person already has a global column with the same key.')
    else { setMessage('Column now applies to every template and workbook.'); await mutate() }
    setSaving(false)
  }

  async function deleteColumn(field: Field) {
    if (!window.confirm(`Delete the column “${field.label}”? Any saved values in it will also be removed.`)) return
    setSaving(true); setFormError(''); setMessage('')
    const { error: deleteError } = await supabase.from('template_fields').delete().eq('id', field.id)
    if (deleteError) setFormError('The column could not be deleted.')
    else { setMessage('Column deleted.'); await mutate() }
    setSaving(false)
  }

  return <>
    <div className="page-heading"><div><div className="kicker">One column per person, every workbook</div><h1>User columns</h1><p>Create a person's columns once. Every template and workbook uses them automatically — no repeated setup.</p></div><Link className="secondary-button" href="/admin/templates"><Columns3 /> Workbook headers</Link></div>
    {(message || formError || error) && <div className="notice" data-tone={formError || error ? 'error' : undefined} role={formError || error ? 'alert' : 'status'}>{formError || error?.message || message}</div>}
    {isLoading ? <div className="empty-state"><LoaderCircle className="animate-spin" /></div> : !people.length ? <section className="card section-card"><div className="empty-state"><span className="empty-icon"><Columns3 /></span><h3>Add a team member first</h3><p>User columns belong to a person. Create the person from People &amp; roles first.</p><Link className="secondary-button" style={{ marginTop: 15 }} href="/admin/users"><Plus /> Go to People &amp; roles</Link></div></section> : <>
      <section className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="section-head" style={{ padding: '0 0 16px', marginBottom: 18 }}><div><h2>Create a column</h2><p>Pick the person and choose how they fill it. The column appears in all their workbook assignments.</p></div></div>
        <form onSubmit={createColumn}>
          <div className="form-grid">
            <div className="form-field"><label htmlFor="column-owner">Column owner</label><select id="column-owner" name="owner_profile_id" value={ownerProfileId} onChange={(event) => setOwnerProfileId(event.target.value)} required><option value="" disabled>Select a person</option>{people.map((person) => <option key={person.id} value={person.id}>{person.full_name} · {roleLabels.get(person.role_code) ?? person.role_code}</option>)}</select></div>
            <div className="form-field"><label htmlFor="column-label">Column label</label><input id="column-label" name="label" required maxLength={80} placeholder="e.g. Call outcome" /></div>
            <div className="form-field"><label htmlFor="column-type">Input type</label><select id="column-type" name="input_type" value={inputType} onChange={(event) => setInputType(event.target.value)}><option value="text">Free text</option><option value="textarea">Long text</option><option value="number">Number</option><option value="date">Date</option><option value="dropdown">Dropdown</option></select></div>
            {inputType === 'dropdown' && <div className="form-field full"><label htmlFor="column-options">Dropdown options</label><textarea id="column-options" name="options" placeholder={'One option per line\nYes\nNo'} required /><span className="form-hint">These appear in the dropdown the owner sees in their workspace.</span></div>}
            <label className="form-field full" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, color: '#4a4144', fontSize: 12 }}><input type="checkbox" name="is_required" style={{ width: 14, minHeight: 0, height: 14 }} /> Required before the owner can complete an assignment</label>
          </div>
          <div className="form-actions"><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Plus />}{saving ? 'Adding…' : 'Add column'}</button></div>
        </form>
      </section>
      <section className="card section-card" style={{ marginTop: 0 }}>
        <div className="section-head"><div><h2>All user columns</h2><p>{fields.length} column{fields.length === 1 ? '' : 's'} · new columns apply to every template and workbook</p></div></div>
        {fields.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Column</th><th>Owner</th><th>Applies to</th><th>Input type</th><th>Options</th><th>Required</th><th>Action</th></tr></thead><tbody>{fields.map((field) => <tr key={field.id}><td style={{ fontWeight: 650 }}>{field.label}</td><td>{ownerLabel(field)}</td><td>{field.template_id ? <div style={{ display: 'grid', gap: 4 }}><span>{scopeLabel(field)}</span><button className="quiet-button" type="button" style={{ justifySelf: 'start', padding: 0 }} onClick={() => void useEverywhere(field)} disabled={saving}>Use in all templates</button></div> : <span className="status-pill"><span className="status-dot" />All templates</span>}</td><td>{inputTypeLabels[field.input_type] ?? field.input_type}</td><td style={{ whiteSpace: 'normal', maxWidth: 260 }}>{field.input_type === 'dropdown' ? field.options.join(', ') : '—'}</td><td>{field.is_required ? 'Required' : 'Optional'}</td><td><button className="quiet-button" type="button" onClick={() => void deleteColumn(field)} disabled={saving} aria-label={`Delete ${field.label}`}><Trash2 /> Delete</button></td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><Columns3 /></span><h3>No user columns yet</h3><p>Add a column above to give a person their own place to record updates across every workbook.</p></div>}
        <div className="notice" style={{ margin: 16 }}><Columns3 /> A user column belongs to one person and applies to every template. They edit it on their assigned leads, the roles above them see it, and head office sees it in the workbook.</div>
      </section>
    </>}
  </>
}
