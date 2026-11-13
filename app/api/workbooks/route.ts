import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHeadOfficeActor } from '@/lib/crm/server-auth'
import { mergeFlowRoles } from '@/lib/crm/reporting-flow'

const CHUNK_SIZE = 500

type ImportRow = Record<string, string | number | boolean | null>

export async function POST(request: Request) {
  const actor = await getHeadOfficeActor()
  if (actor.error) return NextResponse.json({ error: actor.error }, { status: actor.error === 'unauthorized' ? 401 : 403 })

  const body = await request.json().catch(() => null) as null | {
    name?: string; category_id?: string; template_id?: string; status?: string;
    rows?: ImportRow[]; assignee_ids?: string[]; reporting_steps?: Array<{ role_code?: string; step_order?: number }>;
  }
  const name = body?.name?.trim()
  const rows = body?.rows
  const assigneeIds = [...new Set(body?.assignee_ids ?? [])]
  let stepRoles = [...new Set((body?.reporting_steps ?? [])
    .map((step) => step?.role_code)
    .filter((role): role is string => typeof role === 'string' && role.trim().length > 0))]
  if (!name || name.length > 120 || !body?.category_id || !body?.template_id || !Array.isArray(rows) || rows.length < 1 || rows.length > 5000 || assigneeIds.length > 20 || stepRoles.length > 20) {
    return NextResponse.json({ error: 'Add a workbook name, category, template, and a file with 1–5,000 rows.' }, { status: 400 })
  }
  if (body.status && !['active', 'ongoing', 'closed'].includes(body.status)) return NextResponse.json({ error: 'Choose a valid workbook status.' }, { status: 400 })
  if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length > 100)) {
    return NextResponse.json({ error: 'The uploaded file contains invalid rows.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const [{ data: category }, { data: template }, { data: fields }, { data: assignees }] = await Promise.all([
    admin.from('categories').select('id,is_active').eq('id', body.category_id).maybeSingle(),
    admin.from('templates').select('id,category_id').eq('id', body.template_id).maybeSingle(),
    admin.from('template_fields').select('field_key,field_kind,owner_role_code,is_required').eq('template_id', body.template_id),
    assigneeIds.length ? admin.from('profiles').select('id,role_code,is_active').in('id', assigneeIds) : Promise.resolve({ data: [] }),
  ])

  if (!category?.is_active || !template) return NextResponse.json({ error: 'The selected category or template is unavailable.' }, { status: 400 })
  if (template.category_id && template.category_id !== category.id) return NextResponse.json({ error: 'This template belongs to a different category.' }, { status: 400 })
  const sourceFields = (fields ?? []).filter((field) => field.field_kind === 'source')
  const allowedKeys = new Set(sourceFields.map((field) => field.field_key))
  if (!sourceFields.length) return NextResponse.json({ error: 'This template needs at least one source column before it can import a file.' }, { status: 400 })
  if (rows.some((row) => Object.keys(row).some((key) => !allowedKeys.has(key)))) return NextResponse.json({ error: 'The uploaded data contains columns that do not match this template.' }, { status: 400 })
  const missingRequired = sourceFields.filter((field) => field.is_required && rows.some((row) => row[field.field_key] === null || String(row[field.field_key] ?? '').trim() === ''))
  if (missingRequired.length) return NextResponse.json({ error: `Required values are missing for: ${missingRequired.map((field) => field.field_key).join(', ')}.` }, { status: 400 })
  if ((assignees ?? []).length !== assigneeIds.length || (assignees ?? []).some((person) => !person.is_active)) {
    return NextResponse.json({ error: 'One or more selected team members are unavailable.' }, { status: 400 })
  }

  // Every assigned person's role must exist in the flow, otherwise they would
  // only see their own column. Add any missing roles in their canonical place.
  stepRoles = mergeFlowRoles(stepRoles, (assignees ?? []).map((person) => person.role_code))

  const { data: workbook, error: workbookError } = await admin.from('workbooks').insert({
    name,
    category_id: category.id,
    template_id: template.id,
    status: body.status ?? 'active',
    created_by: actor.user.id,
  }).select('id').single()
  if (workbookError || !workbook) return NextResponse.json({ error: 'The workbook could not be created.' }, { status: 500 })

  // Copy the chosen role flow onto the workbook. With no explicit flow, start
  // from the template's default flow so every workbook gets a reporting chain.
  // If the flow table is not available yet the workbook still opens and falls
  // back to Reports to links.
  let flowSaved = true
  if (!stepRoles.length) {
    const { data: templateSteps, error: templateFlowError } = await admin
      .from('template_reporting_steps').select('role_code').eq('template_id', template.id).order('step_order')
    if (templateFlowError) flowSaved = false
    stepRoles = (templateSteps ?? []).map((step) => step.role_code)
  }
  if (stepRoles.length) {
    const { error: flowError } = await admin.from('workbook_reporting_steps').insert(
      stepRoles.map((role_code, index) => ({ workbook_id: workbook.id, role_code, step_order: index + 1 })),
    )
    if (flowError) flowSaved = false
  }

  const leadIds: string[] = []
  for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
    const batch = rows.slice(offset, offset + CHUNK_SIZE).map((source_values, index) => ({
      workbook_id: workbook.id,
      row_number: offset + index + 1,
      source_values,
    }))
    const { data, error } = await admin.from('lead_records').insert(batch).select('id')
    if (error || !data) {
      await admin.from('workbooks').delete().eq('id', workbook.id)
      return NextResponse.json({ error: 'The upload could not be saved. Please check the file mapping and try again.' }, { status: 500 })
    }
    leadIds.push(...data.map((lead) => lead.id))
  }

  if (assigneeIds.length) {
    const roleByUser = new Map((assignees ?? []).map((person) => [person.id, person.role_code]))
    const assignmentRows = leadIds.flatMap((lead_id) => assigneeIds.map((assigned_to) => ({
      lead_id,
      assigned_to,
      assigned_by: actor.user.id,
      role_code: roleByUser.get(assigned_to),
    })))
    for (let offset = 0; offset < assignmentRows.length; offset += CHUNK_SIZE) {
      const { error } = await admin.from('lead_assignments').insert(assignmentRows.slice(offset, offset + CHUNK_SIZE))
      if (error) {
        await admin.from('workbooks').delete().eq('id', workbook.id)
        return NextResponse.json({ error: 'The workbook could not be assigned. No partial workbook was kept.' }, { status: 500 })
      }
    }
    // Queue email notifications for each assignee.
    const { data: notifProfiles } = await admin.from('profiles').select('id,email,full_name').in('id', assigneeIds).eq('is_active', true)
    if (notifProfiles?.length) {
      await admin.from('notification_outbox').insert(notifProfiles.map((p) => ({
        recipient_id: p.id,
        recipient_email: p.email,
        subject: `New leads assigned in "${name}"`,
        body: `Hello ${p.full_name},\n\nYou have been assigned ${leadIds.length} leads in the workbook "${name}". Sign in to your CRM workspace to review and work on them.`,
        sender_id: actor.user.id,
      })))
    }
  }

  return NextResponse.json({ workbook_id: workbook.id, lead_count: leadIds.length, assigned_to: assigneeIds.length, reporting_flow_saved: flowSaved }, { status: 201 })
}
