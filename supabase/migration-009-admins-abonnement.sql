-- =====================================================================
-- Aïlo v0.9.2 : administratrices (par e-mail) et protection de l'abonnement. Rejouable.
-- =====================================================================

-- Fin de période payée de l'abonnement (rempli par Stripe via la fonction serveur)
alter table public.profiles add column if not exists plan_until timestamptz;

-- Le forfait, sa date de fin et le badge « vérifié » ne peuvent être changés que par le serveur
create or replace function public.protect_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.plan := old.plan;
    new.plan_until := old.plan_until;
    new.verified := old.verified;
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect_plan on public.profiles;
create trigger profiles_protect_plan before update on public.profiles
  for each row execute function public.protect_plan();

-- Comptes administrateurs : désignés par leur e-mail, y compris s'ils sont créés plus tard
insert into public.app_secrets (key, value)
values ('admin_emails', 'dermine.nicolas@gmail.com,sarah.maheu@gmail.com')
on conflict (key) do update set value = excluded.value;

create or replace function public.sync_admins() returns void
language plpgsql security definer set search_path = public as $$
declare ids text;
begin
  select string_agg(u.id::text, ',') into ids
  from auth.users u
  where lower(u.email) = any (string_to_array(lower(coalesce((select value from public.app_secrets where key = 'admin_emails'), '')), ','));
  insert into public.app_secrets (key, value) values ('admin_ids', coalesce(ids, ''))
  on conflict (key) do update set value = excluded.value;
  -- Les administratrices ont tous les accès (Premium) sans payer
  update public.profiles set plan = 'premium'
  where id::text = any (string_to_array(coalesce(ids, ''), ',')) and plan = 'base';
end $$;
revoke execute on function public.sync_admins() from public, anon, authenticated;

create or replace function public.on_new_profile_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_admins();
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists profiles_admin_check on public.profiles;
create trigger profiles_admin_check after insert on public.profiles
  for each row execute function public.on_new_profile_admin();

-- Rattrapage pour les comptes déjà recréés
select public.sync_admins();
select (select value from public.app_secrets where key = 'admin_ids') as admin_ids,
       (select string_agg(u.email || ' → ' || p.plan, ', ') from auth.users u join public.profiles p on p.id = u.id) as comptes;
