import type { Metadata } from 'next'
import { SetupForm } from '@/components/auth/setup-form'

export const metadata: Metadata = { title: 'Set up head office' }

export default function SetupPage() {
  return <SetupForm />
}
