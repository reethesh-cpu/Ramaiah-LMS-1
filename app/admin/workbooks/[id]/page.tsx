import type { Metadata } from 'next'
import { WorkbookDetail } from '@/components/crm/workbook-detail'

export const metadata: Metadata = { title: 'Workbook details' }

export default async function WorkbookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <WorkbookDetail workbookId={id} />
}
