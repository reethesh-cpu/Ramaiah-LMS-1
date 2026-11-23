-- Excel-style header layout - part 11 (run after parts 1 to 10)
--
-- Stores how many top rows of an uploaded file are headers and the combined
-- header labels for each source column. This lets the admin and assignees see
-- the same grouped, merged-cell headers as the original spreadsheet.
--
-- Existing workbooks default to one header row and keep their current display.
--
-- Safe to run more than once in the Supabase SQL Editor.

alter table public.workbooks
  add column if not exists header_rows integer not null default 1;

alter table public.template_fields
  add column if not exists header_path jsonb not null default '[]'::jsonb;

create index if not exists workbooks_header_rows_idx
  on public.workbooks (header_rows);

comment on column public.workbooks.header_rows is
  'Number of top spreadsheet rows used as headers; imported lead data starts at header_rows + 1.';

comment on column public.template_fields.header_path is
  'One label per header row for this column, after merged cells are expanded.';
