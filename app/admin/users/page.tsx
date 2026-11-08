'use client'

import Link from 'next/link'
import { FormEvent, useMemo, useState } from 'react'
import useSWR from 'swr'
import { KeyRound, LoaderCircle, Plus, ShieldCheck, UserCheck, UserPlus, UserX } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Role = { role_code: string; label: string; is_system: boolean }
type Person = { id: string; email: string; full_name: string; role_code: string; manager_id: string | null; is_active: boolean; created_at: string }
const supabase = createClient()

async function loadPeople() {
  const [{ data: people, error: peopleError }, { data: roles, error: rolesError }] = await Promise.all([
    supabase.from('profiles').select('id,email,full_name,role_code,manager_id,is_active,created_at').order('full_name'),
    supabase.from('role_definitions').select('role_code,label,is_system').order('label'),
  ])
  if (peopleError || rolesError) throw new Error('People could not be loaded.')
  return { people: (people ?? []) as Person[], roles: (roles ?? []) as Role[] }
}

export default function UsersPage() {
  const { data, error, isLoading, mutate } = useSWR('admin-people-and-roles', loadPeople)
  const [showCreate, setShowCreate] = useState(false)
  const [showRole, setShowRole] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')
  const [resetFor, setResetFor] = useState('')
  const [newRoleLabel, setNewRoleLabel] = useState('')
  const roles = data?.roles ?? []
  const people = data?.people ?? []
  const roleLabels = useMemo(() => new Map(roles.map((role) => [role.role_code, role.label])), [roles])

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setFormError(''); setNotice('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      full_name: form.get('full_name'), email: form.get('email'), password: form.get('password'), role_code: form.get('role_code'), manager_id: form.get('manager_id') || null,
    }) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) setFormError(result.error ?? 'The user could not be created.')
    else { setNotice('User created. Share the temporary sign-in details securely.'); event.currentTarget.reset(); setShowCreate(false); await mutate() }
    setSaving(false)
  }

  async function toggleActive(person: Person) {
    setFormError(''); setNotice('')
    const response = await fetch(`/api/users/${person.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !person.is_active }) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) setFormError(result.error ?? 'The account status could not be changed.')
    else { setNotice(`${person.full_name} is now ${person.is_active ? 'inactive' : 'active'}.`); await mutate() }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>, personId: string) {
    event.preventDefault(); setSaving(true); setFormError(''); setNotice('')
    const password = new FormData(event.currentTarget).get('password')
    const response = await fetch(`/api/users/${personId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) setFormError(result.error ?? 'The password could not be reset.')
    else { setNotice('Password reset. Share it securely with the user.'); setResetFor(''); event.currentTarget.reset() }
    setSaving(false)
  }

  async function addRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError(''); setNotice('')
    const label = newRoleLabel.trim()
    const roleCode = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
    if (!roleCode) { setFormError('Enter a role name using letters or numbers.'); return }
    const { error } = await supabase.from('role_definitions').insert({ role_code: roleCode, label, is_system: false })
    if (error) { setFormError('That role could not be added. Use a unique role name.'); return }
    setNotice('Role added. It is now available when creating a user or field.'); setNewRoleLabel(''); setShowRole(false); await mutate()
  }

  return <>
    <div className="page-heading"><div><div className="kicker">Organization access</div><h1>People & roles</h1><p>Create accounts, set reporting lines, and manage active access.</p></div><button className="primary-button" type="button" onClick={() => setShowCreate((value) => !value)}><UserPlus /> Add a person</button></div>
    {(notice || formError || error) && <div className="notice" data-tone={formError || error ? 'error' : undefined} role={formError || error ? 'alert' : 'status'}>{formError || error?.message || notice}</div>}
    {showCreate && <section className="card card-pad" style={{ marginBottom: 18 }}><div className="section-head" style={{ padding: '0 0 16px', marginBottom: 18 }}><div><h2>Create an account</h2><p>Role and reporting line control which work and team updates are visible.</p></div></div><form onSubmit={createUser}><div className="form-grid">
      <div className="form-field"><label htmlFor="full_name">Full name</label><input id="full_name" name="full_name" autoComplete="name" required maxLength={120} /></div>
      <div className="form-field"><label htmlFor="email">Work email</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
      <div className="form-field"><label htmlFor="role_code">Role</label><select id="role_code" name="role_code" required defaultValue=""><option value="" disabled>Select a role</option>{roles.map((role) => <option key={role.role_code} value={role.role_code}>{role.label}</option>)}</select></div>
      <div className="form-field"><label htmlFor="manager_id">Reports to</label><select id="manager_id" name="manager_id" defaultValue=""><option value="">No direct manager</option>{people.filter((person) => person.is_active).map((person) => <option key={person.id} value={person.id}>{person.full_name} · {roleLabels.get(person.role_code) ?? person.role_code}</option>)}</select></div>
      <div className="form-field full"><label htmlFor="temporary_password">Temporary password</label><input id="temporary_password" name="password" type="password" minLength={8} autoComplete="new-password" required /><span className="form-hint">At least 8 characters. Share it through a secure channel; the app does not email passwords.</span></div>
    </div><div className="form-actions"><button className="secondary-button" type="button" onClick={() => setShowCreate(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Plus />}{saving ? 'Creating…' : 'Create account'}</button></div></form></section>}
    <section className="card section-card" style={{ marginTop: 0 }}>
      <div className="section-head"><div><h2>Organization directory</h2><p>{people.length} accounts · reporting access follows the manager tree</p></div><button className="secondary-button" type="button" onClick={() => setShowRole((value) => !value)}><ShieldCheck /> Manage roles</button></div>
      {showRole && <form onSubmit={addRole} className="toolbar-row" style={{ borderBottom: '1px solid var(--border)', justifyContent: 'flex-start' }}><div className="form-field" style={{ width: 'min(100%, 320px)' }}><label htmlFor="new-role">New role name</label><input id="new-role" value={newRoleLabel} onChange={(event) => setNewRoleLabel(event.target.value)} placeholder="e.g. Regional manager" required /></div><button className="primary-button" style={{ marginTop: 20 }}><Plus /> Add role</button></form>}
      {isLoading ? <div className="empty-state"><LoaderCircle className="animate-spin" /></div> : people.length === 0 ? <div className="empty-state"><span className="empty-icon"><UsersRoundIcon /></span><h3>No team members yet</h3><p>Create the first team account and set its reporting line here.</p></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Person</th><th>Role</th><th>Reports to</th><th>Status</th><th>Access</th></tr></thead><tbody>{people.map((person) => <FragmentRow key={person.id} person={person} roleLabel={roleLabels.get(person.role_code) ?? person.role_code} managerName={people.find((manager) => manager.id === person.manager_id)?.full_name ?? '—'} resetFor={resetFor} setResetFor={setResetFor} saving={saving} onReset={resetPassword} onToggle={toggleActive} />)}</tbody></table></div>}
    </section>
  </>
}

function UsersRoundIcon() { return <UserCheck /> }

function FragmentRow({ person, roleLabel, managerName, resetFor, setResetFor, saving, onReset, onToggle }: {
  person: Person; roleLabel: string; managerName: string; resetFor: string; setResetFor: (id: string) => void; saving: boolean;
  onReset: (event: FormEvent<HTMLFormElement>, id: string) => void; onToggle: (person: Person) => void;
}) {
  return <>
    <tr><td><div style={{ fontWeight: 650 }}>{person.full_name}</div><div className="form-hint" style={{ marginTop: 4 }}>{person.email}</div></td><td>{roleLabel}</td><td>{managerName}</td><td><span className="status-pill" data-tone={person.is_active ? undefined : 'neutral'}><span className="status-dot" />{person.is_active ? 'Active' : 'Inactive'}</span></td><td><div style={{ display: 'flex', gap: 4 }}><button className="quiet-button" type="button" onClick={() => setResetFor(resetFor === person.id ? '' : person.id)} aria-label={`Reset password for ${person.full_name}`}><KeyRound /> Reset</button><button className="quiet-button" type="button" onClick={() => onToggle(person)} aria-label={`${person.is_active ? 'Deactivate' : 'Activate'} ${person.full_name}`}>{person.is_active ? <UserX /> : <UserCheck />}{person.is_active ? 'Deactivate' : 'Activate'}</button></div></td></tr>
    {resetFor === person.id && <tr><td colSpan={5}><form onSubmit={(event) => onReset(event, person.id)} style={{ display: 'flex', alignItems: 'end', gap: 10, padding: '6px 0' }}><div className="form-field" style={{ width: 'min(100%, 300px)' }}><label htmlFor={`reset-${person.id}`}>New temporary password</label><input id={`reset-${person.id}`} name="password" type="password" minLength={8} required /></div><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <KeyRound />} Save password</button><span className="form-hint">Share securely; not emailed.</span></form></td></tr>}
  </>
}
