import type { ReactNode } from 'react'

type BaseField = {
  id: string
  label: string
  field_kind: 'source' | 'user'
  header_path?: string[] | null
  owner_profile_id?: string | null
  owner_role_code?: string | null
}
type GroupCell<F> = { field: F; label: string; colSpan: number; rowSpan: number }

function pathAt(field: BaseField, level: number) {
  return String(field.header_path?.[level] ?? '').trim()
}

function leafLabel(field: BaseField, levels: number) {
  if (!levels || !field.header_path?.length) return field.label
  return field.header_path[field.header_path.length - 1]?.trim() || field.label
}

export function WorkbookTableHeader<F extends BaseField>({ leadingCells, trailingCells, sourceFields, userFields, headerRows, ownerLabel }: {
  leadingCells: ReactNode[]
  trailingCells: ReactNode[]
  sourceFields: F[]
  userFields: F[]
  headerRows: number
  ownerLabel: (field: F) => string
}) {
  const maxPath = sourceFields.reduce((max, field) => Math.max(max, field.header_path?.length ?? 0), 0)
  const levels = maxPath > 1 ? Math.min(Math.max(1, headerRows), maxPath) : 0
  const leafShown = levels === 0 || userFields.length > 0
  const totalRows = levels + (leafShown ? 1 : 0)
  const skip = Array.from({ length: levels }, () => sourceFields.map(() => false))
  const groupRows: GroupCell<F>[][] = []

  for (let level = 0; level < levels; level++) {
    const row: GroupCell<F>[] = []
    for (let index = 0; index < sourceFields.length; index++) {
      if (skip[level][index]) continue
      const field = sourceFields[index]
      const label = pathAt(field, level)
      if (!label) { row.push({ field, label: '', colSpan: 1, rowSpan: 1 }); continue }
      let colSpan = 1
      while (index + colSpan < sourceFields.length && !skip[level][index + colSpan] && pathAt(sourceFields[index + colSpan], level) === label) {
        skip[level][index + colSpan] = true
        colSpan += 1
      }
      let rowSpan = 1
      while (level + rowSpan < levels && pathAt(field, level + rowSpan) === label) {
        skip[level + rowSpan][index] = true
        rowSpan += 1
      }
      row.push({ field, label, colSpan, rowSpan })
    }
    groupRows.push(row)
  }

  return <thead>
    {groupRows.map((row, level) => <tr key={`group-${level}`}>
      {level === 0 && leadingCells.map((cell, index) => <th key={`leading-group-${index}`} rowSpan={totalRows}>{cell}</th>)}
      {row.map((cell) => <th
        key={`group-${level}-${cell.field.id}`}
        className="header-group"
        colSpan={cell.colSpan}
        rowSpan={cell.rowSpan}
      >{cell.label}</th>)}
      {level === 0 && userFields.length > 0 && <th className="header-group" colSpan={userFields.length} rowSpan={levels}>Assigned input</th>}
      {level === 0 && trailingCells.map((cell, index) => <th key={`trailing-group-${index}`} rowSpan={totalRows}>{cell}</th>)}
    </tr>)}
    {leafShown && <tr>
      {levels === 0 && leadingCells.map((cell, index) => <th key={`leading-${index}`}>{cell}</th>)}
      {sourceFields.map((field) => <th key={`source-${field.id}`}>{levels === 0 || !field.header_path?.length ? leafLabel(field, levels) : ''}</th>)}
      {userFields.map((field) => <th key={`user-${field.id}`}>{ownerLabel(field)} · {field.label}</th>)}
      {levels === 0 && trailingCells.map((cell, index) => <th key={`trailing-${index}`}>{cell}</th>)}
    </tr>}
  </thead>
}
