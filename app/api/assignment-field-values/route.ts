import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type SaveBody = {
  lead_id?: string
  field_id?: string
  assignment_id?: string
  value?: unknown
}

function cleanValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}

export async function POST(request: Request) {
  const auth = await createClient()
  const { data: { user }, error: authError } = await auth.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Sign in again to update this column.' }, { status: 401 })

  const body = await request.json().catch(() => null) as SaveBody | null
  const { lead_id: leadId, field_id: fieldId, assignment_id: assignmentId } = body ?? {}
  if (!leadId || !fieldId || !UUID.test(leadId) || !UUID.test(fieldId) || (assignmentId && !UUID.test(assignmentId))) {
    return NextResponse.json({ error: 'Choose a valid lead and column.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: profile, error: profileError } = await admin.from('profiles').select('id,role_code,is_active').eq('id', user.id).maybeSingle()
  if (profileError || !profile?.is_active) return NextResponse.json({ error: 'This account is not active.' }, { status: 403 })
  const isHeadOffice = profile.role_code === 'head_office'

  const [leadResult, fieldResult] = await Promise.all([
    admin.from('lead_records').select('id,workbook_id').eq('id', leadId).maybeSingle(),
    admin.from('template_fields').select('id,field_kind,template_id,workbook_id,owner_profile_id,owner_role_code').eq('id', fieldId).maybeSingle(),
  ])
  if (leadResult.error || fieldResult.error) return NextResponse.json({ error: 'The field could not be checked. Please retry.' }, { status: 500 })
  const lead = leadResult.data
  const field = fieldResult.data
  if (!lead || !field) return NextResponse.json({ error: 'This lead or column no longer exists.' }, { status: 404 })
  if (field.field_kind !== 'user') return NextResponse.json({ error: 'Only user columns can be updated here.' }, { status: 400 })

  const { data: workbook, error: workbookError } = await admin.from('workbooks').select('id,template_id').eq('id', lead.workbook_id).maybeSingle()
  if (workbookError || !workbook) return NextResponse.json({ error: 'This workbook no longer exists.' }, { status: 404 })
  const fieldInWorkbook = field.workbook_id === workbook.id
    || (field.workbook_id === null && (field.template_id === null || field.template_id === workbook.template_id))
  if (!fieldInWorkbook) return NextResponse.json({ error: 'This column does not belong to this workbook.' }, { status: 400 })

  let assignment: { id: string; assigned_to: string; role_code: string; status: string } | null = null
  if (assignmentId) {
    const { data: found, error: assignmentError } = await admin
      .from('lead_assignments').select('id,lead_id,assigned_to,role_code,status').eq('id', assignmentId).maybeSingle()
    if (assignmentError) return NextResponse.json({ error: 'The assignment could not be checked.' }, { status: 500 })
    if (!found || found.lead_id !== leadId) return NextResponse.json({ error: 'This assignment does not belong to the selected row.' }, { status: 400 })
    assignment = found
  }

  if (isHeadOffice) {
    // Head office can edit any visible user column. If the column owner has not
    // been assigned to this row yet, create that assignment so the value has a
    // safe place to live and the owner can continue it in their workspace.
    if (!assignment) {
      if (!field.owner_profile_id) {
        return NextResponse.json({ error: 'Assign this row to the column owner before editing this role column.' }, { status: 400 })
      }
      const { data: owner, error: ownerError } = await admin
        .from('profiles').select('id,role_code,is_active').eq('id', field.owner_profile_id).maybeSingle()
      if (ownerError || !owner?.is_active) return NextResponse.json({ error: 'The column owner is unavailable.' }, { status: 400 })

      const { data: existing } = await admin.from('lead_assignments').select('id,assigned_to,role_code,status')
        .eq('lead_id', leadId).eq('assigned_to', owner.id).maybeSingle()
      if (existing) assignment = existing
      else {
        const { data: created, error: createError } = await admin.from('lead_assignments')
          .upsert({ lead_id: leadId, assigned_to: owner.id, assigned_by: user.id, role_code: owner.role_code }, { onConflict: 'lead_id,assigned_to', ignoreDuplicates: true })
          .select('id,assigned_to,role_code,status').maybeSingle()
        if (createError) return NextResponse.json({ error: 'The column owner could not be assigned to this row.' }, { status: 500 })
        assignment = created ?? (await admin.from('lead_assignments').select('id,assigned_to,role_code,status').eq('lead_id', leadId).eq('assigned_to', owner.id).maybeSingle()).data
      }
    }
    if (!assignment) return NextResponse.json({ error: 'The column owner could not be assigned to this row.' }, { status: 500 })
  } else {
    if (!assignment || assignment.assigned_to !== user.id) {
      return NextResponse.json({ error: 'You can only edit columns assigned to you.' }, { status: 403 })
    }
    if (assignment.status !== 'assigned' && assignment.status !== 'completed') {
      return NextResponse.json({ error: 'This assignment can no longer be edited.' }, { status: 403 })
    }
    const ownsField = field.owner_profile_id
      ? field.owner_profile_id === assignment.assigned_to
      : field.owner_role_code === assignment.role_code
    if (!ownsField) return NextResponse.json({ error: 'This column belongs to a different team member.' }, { status: 403 })
  }

  const value = cleanValue(body?.value)
  const { error: saveError } = await admin.from('assignment_field_values').upsert({
    assignment_id: assignment.id,
    field_id: fieldId,
    value,
    updated_by: user.id,
  }, { onConflict: 'assignment_id,field_id' })
  if (saveError) return NextResponse.json({ error: 'This column could not be saved. Please retry.' }, { status: 500 })

  return NextResponse.json({ assignment_id: assignment.id, field_id: fieldId, value })
}
