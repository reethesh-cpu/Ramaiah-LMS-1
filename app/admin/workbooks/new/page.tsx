import type { Metadata } from 'next'
import { WorkbookCreateForm } from '@/components/crm/workbook-create-form'

export const metadata: Metadata = { title: 'Create workbook' }

export default function NewWorkbookPage() {
  return <WorkbookCreateForm />
}
