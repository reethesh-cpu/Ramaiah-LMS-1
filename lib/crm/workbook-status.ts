// Workbooks are stored as active/ongoing/closed. "Completed" is the admin-facing
// name for closed, so the UI can say completed without changing the database.
export const WORKBOOK_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'closed', label: 'Completed' },
] as const

export type WorkbookStatus = (typeof WORKBOOK_STATUSES)[number]['value']

export function normalizeWorkbookStatus(value: unknown): WorkbookStatus | null {
  if (value === 'completed') return 'closed'
  return WORKBOOK_STATUSES.find((status) => status.value === value)?.value ?? null
}

export function workbookStatusLabel(status: string): string {
  if (status === 'closed' || status === 'completed') return 'Completed'
  return WORKBOOK_STATUSES.find((item) => item.value === status)?.label ?? status
}

export function workbookStatusTone(status: string): 'neutral' | 'amber' | undefined {
  if (status === 'closed' || status === 'completed') return 'neutral'
  if (status === 'ongoing') return 'amber'
  return undefined
}
