-- Add gmail_connected_email column to store the actual Gmail address connected
-- via OAuth (may differ from the user's login email).
alter table public.profiles
  add column if not exists gmail_connected_email text;
