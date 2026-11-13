'use client'

import { ArrowDown, ArrowUp, X } from 'lucide-react'

export type FlowRole = { role_code: string; label: string }

export function ReportingFlowEditor({
  value,
  onChange,
  roles,
  disabled = false,
  emptyHint = 'No roles in this flow yet. Add the lowest role first.',
}: {
  value: string[]
  onChange: (next: string[]) => void
  roles: FlowRole[]
  disabled?: boolean
  emptyHint?: string
}) {
  const labels = new Map(roles.map((role) => [role.role_code, role.label]))
  const available = roles.filter((role) => !value.includes(role.role_code))

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= value.length) return
    const next = [...value]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    onChange(next)
  }

  function remove(roleCode: string) {
    onChange(value.filter((code) => code !== roleCode))
  }

  function add(roleCode: string) {
    if (!roleCode || value.includes(roleCode)) return
    onChange([...value, roleCode])
  }

  return <div style={{ display: 'grid', gap: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
      {value.length ? value.map((roleCode, index) => <span key={roleCode} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #e7a9b2', background: '#fff', borderRadius: 999, padding: '4px 6px 4px 11px', fontSize: 11, fontWeight: 650 }}>
        <span>{index + 1}. {labels.get(roleCode) ?? roleCode}</span>
        <button type="button" className="quiet-button" style={{ padding: 2 }} aria-label={`Move ${labels.get(roleCode) ?? roleCode} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></button>
        <button type="button" className="quiet-button" style={{ padding: 2 }} aria-label={`Move ${labels.get(roleCode) ?? roleCode} down`} disabled={disabled || index === value.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></button>
        <button type="button" className="quiet-button" style={{ padding: 2 }} aria-label={`Remove ${labels.get(roleCode) ?? roleCode}`} disabled={disabled} onClick={() => remove(roleCode)}><X size={13} /></button>
      </span>) : <span className="form-hint">{emptyHint}</span>}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <select aria-label="Add a role to the reporting flow" value="" disabled={disabled || !available.length} onChange={(event) => add(event.target.value)} style={{ minHeight: 34, minWidth: 190, border: '1px solid var(--border)', borderRadius: 8, padding: '0 9px', background: '#fff', color: '#3a3436', fontSize: 12 }}>
        <option value="">{available.length ? 'Add a role to the flow…' : 'Every role is already in the flow'}</option>
        {available.map((role) => <option key={role.role_code} value={role.role_code}>{role.label}</option>)}
      </select>
      {value.length > 0 && <button type="button" className="quiet-button" style={{ padding: '4px 6px' }} disabled={disabled} onClick={() => onChange([])}><X /> Clear flow</button>}
    </div>
  </div>
}
