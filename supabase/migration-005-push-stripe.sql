-- =====================================================================
-- Aïlo v0.6 : notifications push et paiement Stripe
-- À exécuter APRÈS migration-004. Rejouable sans risque.
-- =====================================================================

-- Réglages internes (jamais lisibles depuis l'app : RLS activé, aucune règle)
create table if not exists public.app_secrets (
  key text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-- Secret partagé entre la base et la fonction serveur, généré ici par la base
create extension if not exists pgcrypto with schema extensions;
insert into public.app_secrets (key, value)
values ('hook_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- Abonnements push (un par téléphone / navigateur)
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push les siens" on public.push_subscriptions;
create policy "push les siens" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Référence du paiement Stripe
alter table public.reservations add column if not exists payment_ref text;

-- Chaque nouveau message prévient la fonction serveur, qui envoie le push
create extension if not exists pg_net;
create or replace function public.notify_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare s text;
begin
  select value into s from public.app_secrets where key = 'hook_secret';
  if s is null then return new; end if;
  perform net.http_post(
    url := 'https://yiiwwnrayhestpozgckv.supabase.co/functions/v1/ailo/push',
    body := jsonb_build_object('thread_id', new.thread_id, 'sender_id', new.sender_id, 'actor', auth.uid(), 'body', new.body),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ailo-hook', s),
    timeout_milliseconds := 5000);
  return new;
exception when others then
  return new; -- un souci de notification ne doit jamais bloquer un message
end $$;
drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages
  for each row execute function public.notify_push();

-- Quand Stripe est activé (app_secrets.stripe_required = 'true'),
-- seule la fonction serveur peut passer une location de « à payer » à « confirmée »
create or replace function public.guard_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and old.status = 'acceptee' and new.status = 'confirmee'
     and exists (select 1 from public.app_secrets where key = 'stripe_required' and value = 'true') then
    raise exception 'Le paiement doit passer par la page de paiement.';
  end if;
  return new;
end $$;
drop trigger if exists reservations_guard_payment on public.reservations;
create trigger reservations_guard_payment before update on public.reservations
  for each row execute function public.guard_payment();
