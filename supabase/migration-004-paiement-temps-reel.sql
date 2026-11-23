-- v0.5.0 : étape « acceptée, à payer » et temps réel
alter table public.reservations drop constraint if exists reservations_status_check;
alter table public.reservations add constraint reservations_status_check
  check (status in ('demandee','acceptee','confirmee','remise','rendue','terminee','refusee','annulee','litige'));

create or replace function public.busy_ranges()
returns table(item_id uuid, thread_id uuid, start_date date, end_date date, handover text)
language sql stable security definer set search_path = public as $$
  select item_id, thread_id, start_date, end_date, handover from public.reservations
  where status in ('demandee','acceptee','confirmee','remise','rendue');
$$;

-- Diffusion en direct des nouveaux messages, réservations et pièces (les règles RLS s'appliquent)
do $$ begin
  begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.reservations; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.items; exception when duplicate_object then null; end;
end $$;
