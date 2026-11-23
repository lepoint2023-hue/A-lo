-- =====================================================================
-- Aïlo v0.9 : visite sans compte, signalements. Rejouable.
-- =====================================================================

-- Profils lisibles sans compte, mais seulement les colonnes publiques
drop policy if exists "profils publics" on public.profiles;
create policy "profils publics" on public.profiles for select to anon using (true);
revoke select on public.profiles from anon;
grant select (id, name, zip, city, lat, lng, photo_url, plan, kind, verified) on public.profiles to anon;

-- Palier des loueuses (badge Vedette) et périodes occupées : lisibles sans compte
drop policy if exists "stats publiques" on public.owner_stats;
create policy "stats publiques" on public.owner_stats for select to anon using (true);
grant select on public.owner_stats to anon;
grant execute on function public.busy_ranges() to anon;

-- Signalements (obligation des hébergeurs, DSA art. 16) : on peut signaler, personne ne peut relire depuis l'app
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete set null,
  target_kind text not null check (target_kind in ('item', 'membre')),
  target_id uuid not null,
  reason text not null check (char_length(reason) <= 120),
  details text not null default '' check (char_length(details) <= 500),
  status text not null default 'nouveau' check (status in ('nouveau', 'traite', 'rejete')),
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
drop policy if exists "signaler" on public.reports;
create policy "signaler" on public.reports for insert to anon, authenticated
  with check (reporter_id is null or reporter_id = auth.uid());
revoke all on public.reports from anon, authenticated;
grant insert on public.reports to anon, authenticated;

-- Chaque signalement prévient les administrateurs (liste d'identifiants dans app_secrets.admin_ids)
create or replace function public.notify_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare s text;
begin
  select value into s from public.app_secrets where key = 'hook_secret';
  if s is null then return new; end if;
  perform net.http_post(
    url := 'https://yiiwwnrayhestpozgckv.supabase.co/functions/v1/ailo/report',
    body := jsonb_build_object('id', new.id, 'kind', new.target_kind, 'target', new.target_id, 'reason', new.reason),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ailo-hook', s),
    timeout_milliseconds := 5000);
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists reports_notify on public.reports;
create trigger reports_notify after insert on public.reports
  for each row execute function public.notify_report();
