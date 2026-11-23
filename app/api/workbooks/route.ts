import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHeadOfficeActor } from '@/lib/crm/server-auth'
import { mergeFlowRoles } from '@/lib/crm/reporting-flow'
import { fieldKeyFromLabel } from '@/lib/crm/field-keys'

const CHUNK_SIZE = 500

type ImportRow = Record<string, string | number | boolean | null>
type MergeInput = { s?: { r?: number; c?: number }; e?: { r?: number; c?: number } }
type SourceFieldInput = { label?: string; field_key?: string; is_required?: boolean; header_path?: string[]; column_index?: number | null }
type UserFieldInput = {
  label?: string; field_key?: string; header_path?: string[]; owner_profile_id?: string;
  is_required?: boolean; input_type?: string; options?: string[]; column_index?: number | null
}

export async function POST(request: Request) {
  const actor = await getHeadOfficeActor()
  if (actor.error) return NextResponse.json({ error: actor.error }, { status: actor.error === 'unauthorized' ? 401 : 403 })

  const body = await request.json().catch(() => null) as null | {
    name?: string; category_id?: string; template_id?: string; status?: string;
    rows?: ImportRow[]; row_numbers?: number[]; header_rows?: number; data_start_row?: number;
    sheet_cells?: string[][]; sheet_merges?: MergeInput[]; column_count?: number;
    assignee_ids?: string[]; reporting_steps?: Array<{ role_code?: string; step_order?: number }>;
    source_fields?: SourceFieldInput[]; user_fields?: UserFieldInput[];
  }
  const name = body?.name?.trim()
  const rows = body?.rows
  const assigneeIds = [...new Set(body?.assignee_ids ?? [])]
  let stepRoles = [...new Set((body?.reporting_steps ?? [])
    .map((step) => step?.role_code)
    .filter((role): role is string => typeof role === 'string' && role.trim().length > 0))]

  const hasTemplate = typeof body?.template_id === 'string' && body.template_id.length > 0
  const headerRows = Number.isInteger(body?.header_rows) ? Math.min(10, Math.max(0, Number(body!.header_rows))) : 1
  const sheetCells = Array.isArray(body?.sheet_cells) ? body!.sheet_cells.filter((row) => Array.isArray(row)).slice(0, 5000) : []
  const dataStartRow = Number.isInteger(body?.data_start_row) ? Math.max(1, Number(body!.data_start_row)) : headerRows + 1
  const rawSourceFields = Array.isArray(body?.source_fields) ? body!.source_fields : []
  const rawUserFields = Array.isArray(body?.user_fields) ? body!.user_fields : []
  const rowNumbers = Array.isArray(body?.row_numbers) ? body!.row_numbers : []
  const ownerIds = [...new Set(rawUserFields.map((field) => String(field?.owner_profile_id ?? '')).filter(Boolean))]

  if (!name || name.length > 120 || !body?.category_id || !Array.isArray(rows) || rows.length < 1 || rows.length > 5000 || assigneeIds.length > 20 || stepRoles.length > 20) {
    return NextResponse.json({ error: 'Add a workbook name, category, and a file with 1–5,000 data rows.' }, { status: 400 })
  }
  if (!hasTemplate && rawSourceFields.length < 1) {
    return NextResponse.json({ error: 'Upload a file so the workbook can use its header rows as columns.' }, { status: 400 })
  }
  if (body.status && !['active', 'ongoing', 'closed'].includes(body.status)) return NextResponse.json({ error: 'Choose a valid workbook status.' }, { status: 400 })
  if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length > 120)) {
    return NextResponse.json({ error: 'The uploaded file contains invalid rows.' }, { status: 400 })
  }
  if (rowNumbers.length && (rowNumbers.length !== rows.length || rowNumbers.some((value) => !Number.isInteger(value) || Number(value) < dataStartRow))) {
    return NextResponse.json({ error: 'The uploaded row numbers are invalid.' }, { status: 400 })
  }
  if (sheetCells.length && dataStartRow > sheetCells.length) {
    return NextResponse.json({ error: 'The data start row is beyond the uploaded sheet.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: category } = await admin.from('categories').select('id,is_active').eq('id', body.category_id).maybeSingle()
  const [templateResult, templateFieldsResult, profileResult] = await Promise.all([
    hasTemplate ? admin.from('templates').select('id,category_id').eq('id', body!.template_id as string).maybeSingle() : Promise.resolve({ data: null }),
    hasTemplate ? admin.from('template_fields').select('field_key,field_kind,is_required,label').eq('template_id', body!.template_id as string) : Promise.resolve({ data: [] }),
    [...assigneeIds, ...ownerIds].length
      ? admin.from('profiles').select('id,role_code,is_active').in('id', [...new Set([...assigneeIds, ...ownerIds])])
      : Promise.resolve({ data: [] as Array<{ id: string; role_code: string; is_active: boolean }> }),
  ])
  const template = templateResult.data
  const profiles = (profileResult.data ?? []) as Array<{ id: string; role_code: string; is_active: boolean }>
  const roleById = new Map(profiles.map((person) => [person.id, person.role_code]))

  if (!category?.is_active) return NextResponse.json({ error: 'The selected category is unavailable.' }, { status: 400 })
  if (hasTemplate && !template) return NextResponse.json({ error: 'The selected template is unavailable.' }, { status: 400 })
  if (hasTemplate && template?.category_id && template.category_id !== category.id) return NextResponse.json({ error: 'This template belongs to a different category.' }, { status: 400 })
  if (assigneeIds.some((id) => !profiles.some((person) => person.id === id && person.is_active))) {
    return NextResponse.json({ error: 'One or more selected team members are unavailable.' }, { status: 400 })
  }
  if (ownerIds.some((id) => !profiles.some((person) => person.id === id && person.is_active))) {
    return NextResponse.json({ error: 'One or more selected column owners are unavailable.' }, { status: 400 })
  }

  const cleanPath = (value: unknown): string[] => Array.isArray(value)
    ? value.slice(0, 10).map((item) => String(item ?? '').trim().slice(0, 120))
    : []

  let sourceFields: Array<{ field_key: string; label: string; is_required: boolean; header_path: string[]; column_index: number | null }>
  if (hasTemplate) {
    sourceFields = ((templateFieldsResult.data ?? []) as Array<{ field_key: string; field_kind: string; is_required: boolean; label: string }>)
      .filter((field) => field.field_kind === 'source')
      .map((field) => ({ field_key: field.field_key, label: field.label, is_required: field.is_required, header_path: [], column_index: null }))
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
      sourceFields.push({ field_key: key, label, is_required: Boolean(raw?.is_required), header_path: cleanPath(raw?.header_path), column_index: Number.isInteger(raw?.column_index) ? Number(raw!.column_index) : null })
      if (sourceFields.length >= 120) break
    }
  }

  const userFields: Array<{
    field_key: string; label: string; header_path: string[]; owner_profile_id: string;
    owner_role_code: string; is_required: boolean; input_type: string; options: string[]; column_index: number | null
  }> = []
  const usedKeys = new Set(sourceFields.map((field) => field.field_key))
  for (const raw of rawUserFields) {
    const label = String(raw?.label ?? '').trim().slice(0, 120)
    const ownerProfileId = String(raw?.owner_profile_id ?? '').trim()
    if (!label || !ownerProfileId || !roleById.has(ownerProfileId)) continue
    if (userFields.length >= 120) break
    let key = String(raw?.field_key ?? '').trim() || fieldKeyFromLabel(`${roleById.get(ownerProfileId) ?? 'user'} ${label}`, 80)
    const base = key.slice(0, 80)
    let suffix = 2
    while (usedKeys.has(key)) key = `${base.slice(0, 72)}_${suffix++}`
    usedKeys.add(key)
    const inputType = ['text', 'textarea', 'number', 'date', 'dropdown'].includes(String(raw?.input_type ?? ''))
      ? String(raw!.input_type) : 'text'
    userFields.push({
      field_key: key,
      label,
      header_path: cleanPath(raw?.header_path),
      owner_profile_id: ownerProfileId,
      owner_role_code: roleById.get(ownerProfileId) ?? '',
      is_required: Boolean(raw?.is_required),
      input_type: inputType,
      options: Array.isArray(raw?.options) ? raw!.options.slice(0, 40).map((option) => String(option ?? '').trim().slice(0, 80)).filter(Boolean) : [],
      column_index: Number.isInteger(raw?.column_index) ? Number(raw!.column_index) : null,
    })
  }

  const allowedKeys = new Set(sourceFields.map((field) => field.field_key))
  if (!sourceFields.length) return NextResponse.json({ error: 'The workbook needs at least one header column.' }, { status: 400 })
  if (rows.some((row) => Object.keys(row).some((key) => !allowedKeys.has(key)))) return NextResponse.json({ error: 'The uploaded data contains columns that do not match the workbook headers.' }, { status: 400 })
  const missingRequired = sourceFields.filter((field) => field.is_required && rows.some((row) => row[field.field_key] === null || String(row[field.field_key] ?? '').trim() === ''))
  if (missingRequired.length) return NextResponse.json({ error: `Required values are missing for: ${missingRequired.map((field) => field.label || field.field_key).join(', ')}.` }, { status: 400 })

  // Every assigned person's role must exist in the flow, otherwise they would
  // only see their own column. Add any missing roles in their canonical place.
  stepRoles = mergeFlowRoles(stepRoles, profiles.filter((person) => assigneeIds.includes(person.id)).map((person) => person.role_code))

  const { data: workbook, error: workbookError } = await admin.from('workbooks').insert({
    name,
    category_id: category.id,
    template_id: hasTemplate ? template!.id : null,
    status: body.status ?? 'active',
    created_by: actor.user.id,
    header_rows: headerRows,
    data_start_row: dataStartRow,
    sheet_cells: sheetCells,
    sheet_merges: Array.isArray(body?.sheet_merges) ? body!.sheet_merges.slice(0, 2000).map((merge) => ({
      s: { r: Number(merge?.s?.r ?? 0), c: Number(merge?.s?.c ?? 0) },
      e: { r: Number(merge?.e?.r ?? 0), c: Number(merge?.e?.c ?? 0) },
    })) : [],
    column_count: Number.isInteger(body?.column_count) ? Number(body!.column_count) : sheetCells[0]?.length ?? 0,
  }).select('id').single()
  if (workbookError || !workbook) {
    return NextResponse.json({ error: 'The workbook could not be created. Run supabase/manual-apply/09_reporting_flow.sql, 10_workbook_direct_upload.sql, 11_excel_header_layout.sql, and 12_preserve_excel_grid.sql in Supabase.' }, { status: 500 })
  }

  const fieldRows = [
    ...(!hasTemplate ? sourceFields.map((field, index) => ({
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
      header_path: field.header_path,
      column_index: field.column_index,
    })) : []),
    ...userFields.map((field, index) => ({
      workbook_id: workbook.id,
      template_id: null,
      field_key: field.field_key,
      label: field.label,
      field_kind: 'user',
      owner_role_code: field.owner_role_code,
      owner_profile_id: field.owner_profile_id,
      input_type: field.input_type,
      options: field.options,
      is_required: field.is_required,
      sort_order: 100 + index,
      header_path: field.header_path,
      column_index: field.column_index,
    })),
  ]
  if (fieldRows.length) {
    const { error: fieldInsertError } = await admin.from('template_fields').insert(fieldRows)
    if (fieldInsertError) {
      await admin.from('workbooks').delete().eq('id', workbook.id)
      return NextResponse.json({ error: 'The workbook columns could not be saved. Run supabase/manual-apply/10_workbook_direct_upload.sql, 11_excel_header_layout.sql, and 12_preserve_excel_grid.sql in Supabase.' }, { status: 500 })
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
      row_number: rowNumbers.length ? Number(rowNumbers[offset + index]) : dataStartRow + offset + index,
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
    const roleByUser = new Map(profiles.map((person) => [person.id, person.role_code]))
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

  return NextResponse.json({ workbook_id: workbook.id, lead_count: leadIds.length, assigned_to: assigneeIds.length, reporting_flow_saved: flowSaved, data_start_row: dataStartRow }, { status: 201 })
}
