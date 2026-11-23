-- =====================================================================
-- Aïlo v0.8 : suivre un profil, bonus « gros loueur » (commission dégressive)
-- À exécuter après migration-005. Rejouable sans risque.
-- =====================================================================

-- ---------- Suivre un profil ----------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);
create index if not exists follows_followed_idx on public.follows(followed_id);
alter table public.follows enable row level security;
drop policy if exists "suivis lecture" on public.follows;
create policy "suivis lecture" on public.follows for select to authenticated using (true);
drop policy if exists "suivre" on public.follows;
create policy "suivre" on public.follows for insert to authenticated with check (follower_id = auth.uid());
drop policy if exists "ne plus suivre" on public.follows;
create policy "ne plus suivre" on public.follows for delete to authenticated using (follower_id = auth.uid());
revoke all on public.follows from anon;
grant select, insert, delete on public.follows to authenticated;

-- Nouvelle pièce en ligne : la fonction serveur prévient les abonnées
create or replace function public.notify_new_item() returns trigger
language plpgsql security definer set search_path = public as $$
declare s text;
begin
  if new.status <> 'online' then return new; end if;
  select value into s from public.app_secrets where key = 'hook_secret';
  if s is null then return new; end if;
  perform net.http_post(
    url := 'https://yiiwwnrayhestpozgckv.supabase.co/functions/v1/ailo/follow',
    body := jsonb_build_object('item_id', new.id, 'owner_id', new.owner_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ailo-hook', s),
    timeout_milliseconds := 5000);
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists items_notify_followers on public.items;
create trigger items_notify_followers after insert on public.items
  for each row execute function public.notify_new_item();

-- ---------- Bonus gros loueur ----------
-- Nombre de locations terminées par loueuse (tenu à jour par la base, non modifiable depuis l'app)
create table if not exists public.owner_stats (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  rentals_done int not null default 0
);
alter table public.owner_stats enable row level security;
drop policy if exists "stats lecture" on public.owner_stats;
create policy "stats lecture" on public.owner_stats for select to authenticated using (true);
revoke all on public.owner_stats from anon, authenticated;
grant select on public.owner_stats to authenticated;

-- Paliers : 15 % de base, 12 % dès 10 locations terminées, 10 % dès 30
create or replace function public.commission_for(owner uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when coalesce(max(rentals_done), 0) >= 30 then 0.10
              when coalesce(max(rentals_done), 0) >= 10 then 0.12
              else 0.15 end
  from public.owner_stats where owner_id = owner;
$$;

-- Le taux est figé au moment de la réservation, calculé par la base (jamais par l'app)
alter table public.reservations add column if not exists commission_rate numeric(4,3);
update public.reservations set commission_rate = 0.15 where commission_rate is null;
create or replace function public.set_commission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.commission_rate := public.commission_for(new.owner_id);
  return new;
end $$;
drop trigger if exists reservations_set_commission on public.reservations;
create trigger reservations_set_commission before insert on public.reservations
  for each row execute function public.set_commission();
create or replace function public.keep_commission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.commission_rate := old.commission_rate;
  return new;
end $$;
drop trigger if exists reservations_keep_commission on public.reservations;
create trigger reservations_keep_commission before update on public.reservations
  for each row execute function public.keep_commission();

-- Une location (un colis) terminée compte pour la loueuse
create or replace function public.count_rental_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'terminee' and old.status <> 'terminee' and new.id = new.thread_id then
    insert into public.owner_stats (owner_id, rentals_done) values (new.owner_id, 1)
    on conflict (owner_id) do update set rentals_done = public.owner_stats.rentals_done + 1;
  end if;
  return new;
end $$;
drop trigger if exists reservations_count_done on public.reservations;
create trigger reservations_count_done after update on public.reservations
  for each row execute function public.count_rental_done();

-- Rattrapage des locations déjà terminées
insert into public.owner_stats (owner_id, rentals_done)
select owner_id, count(*) from public.reservations
where status = 'terminee' and id = thread_id group by owner_id
on conflict (owner_id) do update set rentals_done = excluded.rentals_done;
