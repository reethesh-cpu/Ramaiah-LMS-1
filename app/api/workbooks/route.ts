import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHeadOfficeActor } from '@/lib/crm/server-auth'
import { mergeFlowRoles } from '@/lib/crm/reporting-flow'
import { fieldKeyFromLabel } from '@/lib/crm/field-keys'

const CHUNK_SIZE = 500

type ImportRow = Record<string, string | number | boolean | null>
type SourceFieldInput = { label?: string; field_key?: string; is_required?: boolean }

export async function POST(request: Request) {
  const actor = await getHeadOfficeActor()
  if (actor.error) return NextResponse.json({ error: actor.error }, { status: actor.error === 'unauthorized' ? 401 : 403 })

  const body = await request.json().catch(() => null) as null | {
    name?: string; category_id?: string; template_id?: string; status?: string;
    rows?: ImportRow[]; assignee_ids?: string[]; reporting_steps?: Array<{ role_code?: string; step_order?: number }>;
    source_fields?: SourceFieldInput[];
  }
  const name = body?.name?.trim()
  const rows = body?.rows
  const assigneeIds = [...new Set(body?.assignee_ids ?? [])]
  let stepRoles = [...new Set((body?.reporting_steps ?? [])
    .map((step) => step?.role_code)
    .filter((role): role is string => typeof role === 'string' && role.trim().length > 0))]

  const hasTemplate = typeof body?.template_id === 'string' && body.template_id.length > 0
  const rawSourceFields = Array.isArray(body?.source_fields) ? body!.source_fields : []
  if (!name || name.length > 120 || !body?.category_id || !Array.isArray(rows) || rows.length < 1 || rows.length > 5000 || assigneeIds.length > 20 || stepRoles.length > 20) {
    return NextResponse.json({ error: 'Add a workbook name, category, and a file with 1–5,000 rows.' }, { status: 400 })
  }
  if (!hasTemplate && rawSourceFields.length < 1) {
    return NextResponse.json({ error: 'Upload a file so the workbook can use its first row as headers.' }, { status: 400 })
  }
  if (body.status && !['active', 'ongoing', 'closed'].includes(body.status)) return NextResponse.json({ error: 'Choose a valid workbook status.' }, { status: 400 })
  if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length > 120)) {
    return NextResponse.json({ error: 'The uploaded file contains invalid rows.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const [{ data: category }, templateResult, templateFieldsResult, { data: assignees }] = await Promise.all([
    admin.from('categories').select('id,is_active').eq('id', body.category_id).maybeSingle(),
    hasTemplate ? admin.from('templates').select('id,category_id').eq('id', body!.template_id as string).maybeSingle() : Promise.resolve({ data: null }),
    hasTemplate ? admin.from('template_fields').select('field_key,field_kind,owner_role_code,is_required,label').eq('template_id', body!.template_id as string) : Promise.resolve({ data: [] }),
    assigneeIds.length ? admin.from('profiles').select('id,role_code,is_active').in('id', assigneeIds) : Promise.resolve({ data: [] }),
  ])
  const template = templateResult.data

  if (!category?.is_active) return NextResponse.json({ error: 'The selected category is unavailable.' }, { status: 400 })
  if (hasTemplate && !template) return NextResponse.json({ error: 'The selected template is unavailable.' }, { status: 400 })
  if (hasTemplate && template?.category_id && template.category_id !== category.id) return NextResponse.json({ error: 'This template belongs to a different category.' }, { status: 400 })

  let sourceFields: Array<{ field_key: string; label: string; is_required: boolean }>
  if (hasTemplate) {
    sourceFields = ((templateFieldsResult.data ?? []) as Array<{ field_key: string; field_kind: string; is_required: boolean; label: string }>)
      .filter((field) => field.field_kind === 'source')
      .map((field) => ({ field_key: field.field_key, label: field.label, is_required: field.is_required }))
  } else {
    const seen = new Set<string>()
    sourceFields = []
    for (let index = 0; index < rawSourceFields.length; index++) {
      const raw = rawSourceFields[index]
      const label = String(raw?.label ?? '').trim().slice(0, 120)
      if (!label) continue
      let key = String(raw?.field_key ?? '').trim() || fieldKeyFromLabel(label, 80)
      if (!key) continue
      const base = key.slice(0, 80)
      let suffix = 2
      while (seen.has(key)) key = `${base.slice(0, 72)}_${suffix++}`
      seen.add(key)
      sourceFields.push({ field_key: key, label, is_required: Boolean(raw?.is_required) })
      if (sourceFields.length >= 120) break
    }
  }

  const allowedKeys = new Set(sourceFields.map((field) => field.field_key))
  if (!sourceFields.length) return NextResponse.json({ error: 'The workbook needs at least one header column.' }, { status: 400 })
  if (rows.some((row) => Object.keys(row).some((key) => !allowedKeys.has(key)))) return NextResponse.json({ error: 'The uploaded data contains columns that do not match the workbook headers.' }, { status: 400 })
  const missingRequired = sourceFields.filter((field) => field.is_required && rows.some((row) => row[field.field_key] === null || String(row[field.field_key] ?? '').trim() === ''))
  if (missingRequired.length) return NextResponse.json({ error: `Required values are missing for: ${missingRequired.map((field) => field.label || field.field_key).join(', ')}.` }, { status: 400 })
  if ((assignees ?? []).length !== assigneeIds.length || (assignees ?? []).some((person) => !person.is_active)) {
    return NextResponse.json({ error: 'One or more selected team members are unavailable.' }, { status: 400 })
  }

  // Every assigned person's role must exist in the flow, otherwise they would
  // only see their own column. Add any missing roles in their canonical place.
  stepRoles = mergeFlowRoles(stepRoles, (assignees ?? []).map((person) => person.role_code))

  const { data: workbook, error: workbookError } = await admin.from('workbooks').insert({
    name,
    category_id: category.id,
    template_id: hasTemplate ? template!.id : null,
    status: body.status ?? 'active',
    created_by: actor.user.id,
  }).select('id').single()
  if (workbookError || !workbook) return NextResponse.json({ error: 'The workbook could not be created.' }, { status: 500 })

  if (!hasTemplate) {
    const fieldRows = sourceFields.map((field, index) => ({
      workbook_id: workbook.id,
      template_id: null,
      field_key: field.field_key,
      label: field.label,
      field_kind: 'source',
      owner_role_code: null,
      owner_profile_id: null,
      input_type: 'text',
      options: [],
      is_required: field.is_required,
      sort_order: index,
    }))
    const { error: fieldInsertError } = await admin.from('template_fields').insert(fieldRows)
    if (fieldInsertError) {
      await admin.from('workbooks').delete().eq('id', workbook.id)
      return NextResponse.json({ error: 'The workbook headers could not be saved. Run supabase/manual-apply/10_workbook_direct_upload.sql in Supabase.' }, { status: 500 })
    }
  }

  // Copy the chosen role flow onto the workbook. With no explicit flow, start
  // from the template's default flow so every workbook gets a reporting chain.
  // If the flow table is not available yet the workbook still opens, but only
  // assigned people and head office can see its leads.
  let flowSaved = true
  if (!stepRoles.length && hasTemplate && template) {
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
