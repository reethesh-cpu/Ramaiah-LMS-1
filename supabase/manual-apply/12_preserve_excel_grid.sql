-- Preserve the uploaded worksheet - part 12 (run after parts 1 to 11)
--
-- The whole sheet (header rows, data rows, blank rows and merge ranges) is
-- stored on the workbook. Admins choose the row where real data starts; column
-- and row numbers are never renumbered or reinterpreted.
--
-- Existing workbooks keep their current layout (they have no stored grid).
--
-- Safe to run more than once in the Supabase SQL Editor.

alter table public.workbooks
  add column if not exists data_start_row integer not null default 2;

alter table public.workbooks
  add column if not exists sheet_cells jsonb not null default '[]'::jsonb;

alter table public.workbooks
  add column if not exists sheet_merges jsonb not null default '[]'::jsonb;

alter table public.workbooks
  add column if not exists column_count integer not null default 0;

alter table public.template_fields
  add column if not exists column_index integer;

create index if not exists template_fields_column_index_idx
  on public.template_fields (workbook_id, column_index);

comment on column public.workbooks.data_start_row is
  '1-based Excel row number chosen by the admin where actual data begins.';

comment on column public.workbooks.sheet_cells is
  'The full uploaded grid, including header rows and blank rows, exactly as read from the file.';

comment on column public.workbooks.sheet_merges is
  'Excel merge ranges ({s:{r,c},e:{r,c}}, zero-based) used to reproduce merged cells in the web view.';
