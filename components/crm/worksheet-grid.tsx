import type { ReactNode } from 'react'
import type { MergeRange } from '@/lib/crm/excel-sheet'

type SourceFieldLike = { id: string; field_key: string; column_index: number | null; label: string }
type UserFieldLike = { id: string; label: string }
type LeadLike = { row_number: number; source_values: Record<string, string | number | boolean | null> }
type Span = { skip: boolean; rowSpan: number; colSpan: number }
type TrailingColumn<L> = { header: ReactNode; forRow: (lead: L | undefined, rowNumber: number) => ReactNode }

export function WorksheetGrid<S extends SourceFieldLike, U extends UserFieldLike, L extends LeadLike>({
  sheetCells, sheetMerges, dataStartRow, columnCount, sourceFields, userFields, leads,
  visibleRowNumbers, leadingHeader, leadingForRow, trailingColumns, trailingHeader, trailingForRow,
  renderSourceCell, renderUserCell,
}: {
  sheetCells: string[][]
  sheetMerges: MergeRange[]
  dataStartRow: number
  columnCount: number
  sourceFields: S[]
  userFields: U[]
  leads: L[]
  visibleRowNumbers?: Set<number>
  leadingHeader: ReactNode
  leadingForRow: (lead: L | undefined, rowNumber: number) => ReactNode
  trailingColumns?: Array<TrailingColumn<L>>
  trailingHeader?: ReactNode
  trailingForRow?: (lead: L | undefined, rowNumber: number) => ReactNode
  renderSourceCell?: (lead: L | undefined, field: S, value: string, rowNumber: number) => ReactNode
  renderUserCell: (lead: L | undefined, field: U, rowNumber: number) => ReactNode
}) {
  const headerCount = Math.min(sheetCells.length, Math.max(0, dataStartRow - 1))
  const dataIndices: number[] = []
  for (let index = headerCount; index < sheetCells.length; index++) {
    if (!visibleRowNumbers || visibleRowNumbers.has(index + 1)) dataIndices.push(index)
  }
  const headerIndices = headerCount > 0 ? Array.from({ length: headerCount }, (_, index) => index) : []
  const rowPosition = new Map<number, number>()
  ;[...headerIndices, ...dataIndices].forEach((sheetIndex, position) => rowPosition.set(sheetIndex, position))

  function spanFor(sheetRow: number, column: number): Span {
    const merge = sheetMerges.find((item) => sheetRow >= item.s.r && sheetRow <= item.e.r && column >= item.s.c && column <= item.e.c)
    if (!merge) return { skip: false, rowSpan: 1, colSpan: 1 }
    if (sheetRow !== merge.s.r || column !== merge.s.c) return { skip: true, rowSpan: 1, colSpan: 1 }
    const positions: number[] = []
    for (let row = merge.s.r; row <= merge.e.r; row++) {
      const position = rowPosition.get(row)
      if (position !== undefined) positions.push(position)
    }
    const anchorPosition = rowPosition.get(merge.s.r)
    let rowSpan = 1
    if (anchorPosition !== undefined) {
      for (let index = 1; index < positions.length; index++) {
        if (positions[index] !== positions[index - 1] + 1) break
        rowSpan += 1
      }
    }
    return { skip: false, rowSpan, colSpan: Math.max(1, Math.min(columnCount, merge.e.c + 1) - merge.s.c) }
  }

  const leadByRow = new Map(leads.map((lead) => [lead.row_number, lead]))
  const headerRowSpan = Math.max(1, headerCount)
  const trailing = trailingColumns?.length
    ? trailingColumns
    : [{ header: trailingHeader, forRow: trailingForRow ?? (() => null) }]

  return <>
    {headerIndices.length > 0 ? headerIndices.map((sheetRow, rowPositionIndex) => <tr key={`header-${sheetRow}`}>
      {rowPositionIndex === 0 && <th rowSpan={headerRowSpan}>{leadingHeader}</th>}
      {sourceFields.map((field, fieldIndex) => {
        const column = field.column_index ?? fieldIndex
        const span = spanFor(sheetRow, column)
        if (span.skip) return null
        const value = sheetCells[sheetRow]?.[column] ?? ''
        return <th key={`header-${sheetRow}-${field.id}`} className="header-group" rowSpan={span.rowSpan} colSpan={span.colSpan}>{value}</th>
      })}
      {userFields.length > 0 && rowPositionIndex === 0 && <th className="header-group" colSpan={userFields.length} rowSpan={headerRowSpan}>Assigned input</th>}
      {rowPositionIndex === 0 && trailing.map((column, index) => <th key={`trailing-header-${index}`} rowSpan={headerRowSpan}>{column.header}</th>)}
    </tr>) : <tr>
      <th>{leadingHeader}</th>
      {sourceFields.map((field) => <th key={`legacy-${field.id}`}>{field.label}</th>)}
      {userFields.map((field) => <th key={`legacy-user-${field.id}`}>{field.label}</th>)}
      {trailing.map((column, index) => <th key={`legacy-trailing-${index}`}>{column.header}</th>)}
    </tr>}
    {dataIndices.map((sheetIndex) => {
      const rowNumber = sheetIndex + 1
      const lead = leadByRow.get(rowNumber)
      return <tr key={`data-${rowNumber}`}>
        <td>{leadingForRow(lead, rowNumber)}</td>
        {sourceFields.map((field, fieldIndex) => {
          const column = field.column_index ?? fieldIndex
          const span = spanFor(sheetIndex, column)
          if (span.skip) return null
          const sheetValue = sheetCells[sheetIndex]?.[column] ?? ''
          const value = lead ? String(lead.source_values[field.field_key] ?? sheetValue ?? '') : sheetValue
          return <td key={`cell-${rowNumber}-${field.id}`} rowSpan={span.rowSpan} colSpan={span.colSpan}>
            {renderSourceCell ? renderSourceCell(lead, field, value, rowNumber) : value}
          </td>
        })}
        {userFields.map((field) => <td key={`user-${rowNumber}-${field.id}`}>{renderUserCell(lead, field, rowNumber)}</td>)}
        {trailing.map((column, index) => <td key={`trailing-${rowNumber}-${index}`}>{column.forRow(lead, rowNumber)}</td>)}
      </tr>
    })}
  </>
}
