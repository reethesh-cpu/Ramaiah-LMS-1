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
  for (let column = 0; column < sheet.columnCount; column++) {
    const headerPath: string[] = []
    for (let row = 0; row < headerRows; row++) {
      headerPath.push(valueAt(sheet.rows, sheet.merges, row, column))
    }
    const parts: string[] = []
    for (const value of headerPath) if (value && !parts.includes(value)) parts.push(value)
    const label = parts.join(' · ') || `Column ${XLSX.utils.encode_col(column)}`
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

// dataStartRow is the 1-based Excel row number where actual data begins. Every
// row from there onward is kept exactly as it appears in the file, blank rows
// included, so the web view matches the spreadsheet.
export function dataRows(sheet: ParsedSheet, dataStartRow: number): DataRow[] {
  const rows: DataRow[] = []
  for (let index = Math.max(0, dataStartRow - 1); index < sheet.rows.length; index++) {
    rows.push({ excelRow: index + 1, cells: sheet.rows[index] ?? [] })
    if (rows.length >= 5000) break
  }
  return rows
}

export type MergeSpans = {
  covered: Set<string>
  spans: Map<string, { rowSpan: number; colSpan: number }>
}

// Clamp Excel merge ranges to the visible grid so merged header/data cells can
// be rendered with the same rowSpan/colSpan in HTML.
export function buildMergeSpans(rowCount: number, columnCount: number, merges: MergeRange[]): MergeSpans {
  const covered = new Set<string>()
  const spans = new Map<string, { rowSpan: number; colSpan: number }>()
  for (const merge of merges) {
    const rowStart = Math.max(0, merge.s.r)
    const rowEnd = Math.min(rowCount - 1, merge.e.r)
    const colStart = Math.max(0, merge.s.c)
    const colEnd = Math.min(columnCount - 1, merge.e.c)
    if (rowStart > rowEnd || colStart > colEnd) continue
    spans.set(`${rowStart}:${colStart}`, { rowSpan: rowEnd - rowStart + 1, colSpan: colEnd - colStart + 1 })
    for (let row = rowStart; row <= rowEnd; row++) {
      for (let column = colStart; column <= colEnd; column++) {
        if (row !== rowStart || column !== colStart) covered.add(`${row}:${column}`)
      }
    }
  }
  return { covered, spans }
}

export function detectDataStartRow(sheet: ParsedSheet): number {
  for (let index = 1; index < sheet.rows.length; index++) {
    if ((sheet.rows[index] ?? []).some((cell) => String(cell ?? '').trim())) return index + 1
  }
  return Math.min(2, sheet.rows.length)
}
