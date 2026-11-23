import * as XLSX from 'xlsx'

export type MergeRange = { s: { r: number; c: number }; e: { r: number; c: number } }
export type ParsedSheet = { rows: string[][]; merges: MergeRange[]; columnCount: number; rowCount: number }
export type HeaderColumn = {
  columnIndex: number
  letter: string
  label: string
  headerPath: string[]
  sample: string
}
export type DataRow = { excelRow: number; cells: string[] }

// Excel puts a group name in the top-left cell of a merge. Copy that value into
// every covered cell so a header row can be combined into one column label.
export function valueAt(rows: string[][], merges: MergeRange[], row: number, column: number): string {
  const direct = String(rows[row]?.[column] ?? '').trim()
  if (direct) return direct
  const merge = merges.find((range) => row >= range.s.r && row <= range.e.r && column >= range.s.c && column <= range.e.c)
  if (!merge) return ''
  return String(rows[merge.s.r]?.[merge.s.c] ?? '').trim()
}

export function parseSheet(bytes: ArrayBuffer): ParsedSheet {
  const book = XLSX.read(bytes, { type: 'array', cellDates: false })
  const sheet = book.Sheets[book.SheetNames[0]]
  if (!sheet) throw new Error('The file does not contain a worksheet.')
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  }) as string[][]
  if (!rows.length) throw new Error('The worksheet is empty.')
  const merges = (sheet['!merges'] ?? []) as MergeRange[]
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0)
  if (!columnCount) throw new Error('The worksheet has no columns.')
  return { rows, merges, columnCount, rowCount: rows.length }
}

export function buildHeaderColumns(sheet: ParsedSheet, headerRows: number): HeaderColumn[] {
  const columns: HeaderColumn[] = []
  const seen = new Set<string>()
  for (let column = 0; column < sheet.columnCount; column++) {
    const headerPath: string[] = []
    for (let row = 0; row < headerRows; row++) {
      headerPath.push(valueAt(sheet.rows, sheet.merges, row, column))
    }
    const parts: string[] = []
    for (const value of headerPath) if (value && !parts.includes(value)) parts.push(value)
    let label = parts.join(' · ') || `Column ${XLSX.utils.encode_col(column)}`
    if (seen.has(label)) {
      let suffix = 2
      while (seen.has(`${label} (${suffix})`)) suffix += 1
      label = `${label} (${suffix})`
    }
    seen.add(label)
    const sampleRow = sheet.rows.slice(headerRows).find((row) => String(row[column] ?? '').trim())
    columns.push({
      columnIndex: column,
      letter: XLSX.utils.encode_col(column),
      label: label.slice(0, 120),
      headerPath: headerPath.map((value) => value.slice(0, 120)),
      sample: String(sampleRow?.[column] ?? '').slice(0, 80),
    })
  }
  return columns
}

export function dataRows(sheet: ParsedSheet, headerRows: number): DataRow[] {
  const rows: DataRow[] = []
  for (let index = headerRows; index < sheet.rows.length; index++) {
    const cells = sheet.rows[index] ?? []
    if (!cells.some((cell) => String(cell ?? '').trim())) continue
    rows.push({ excelRow: index + 1, cells })
    if (rows.length >= 5000) break
  }
  return rows
}
