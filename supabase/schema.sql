-- =====================================================================
-- Aïlo — schéma de la base Supabase (v1)
-- À coller dans Supabase : SQL Editor → New query → Run.
-- Sécurité : chaque table est protégée par des règles « ligne par ligne »
-- (RLS) : chacun ne voit et ne modifie que ce qui le concerne.
-- =====================================================================

-- ---------- Profils (un par compte) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  zip text,
  city text,
  lat double precision,            -- centre de la commune, jamais l'adresse
  lng double precision,
  photo_url text,
  plan text not null default 'base' check (plan in ('base','premium','pro','partenaire')),
  kind text not null default 'particuliere' check (kind in ('particuliere','pro','boutique')),
  verified boolean not null default false,
  accepted_terms_at timestamptz,
  created_at timestamptz not null default now()
);

-- Profil créé automatiquement à l'inscription
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Pièces du dressing ----------
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  description text default '',
  defects text default '',
  brand text default '',
  category text not null,
  style text not null,
  color text not null,
  size text not null,
  condition text not null check (condition in ('Neuf avec étiquette','Neuf sans étiquette','Comme neuf','Très bon état','Bon état')),
  occasions text[] not null default '{}',
  prices jsonb not null default '{}'::jsonb,     -- {"we":20,"sem":30,"deux":45,"mois":null}
  deposit numeric(8,2) not null default 0 check (deposit >= 0),
  cleaning_fee numeric(8,2) not null default 0 check (cleaning_fee >= 0),
  cleaning_required boolean not null default false,
  handover text not null default 'main' check (handover in ('main','envoi','both')),
  instant boolean not null default false,
  unavailable jsonb not null default '[]'::jsonb, -- [{"start":"2027-04-01","end":"2027-04-10"}]
  photos text[] not null default '{}',            -- chemins dans le stockage « photos »
  status text not null default 'online' check (status in ('online','paused','removed')),
  created_at timestamptz not null default now()
);
create index if not exists items_owner_idx on public.items(owner_id);
create index if not exists items_status_idx on public.items(status);

-- ---------- Réservations (une ligne par pièce ; thread_id regroupe un colis) ----------
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  item_id uuid not null references public.items(id),
  renter_id uuid not null references public.profiles(id),
  owner_id uuid not null references public.profiles(id),
  duration_id text not null check (duration_id in ('we','sem','deux','mois')),
  start_date date not null,
  end_date date not null,
  cleaning text not null default 'propre' check (cleaning in ('propre','forfait')),
  handover text not null default 'main' check (handover in ('main','envoi')),
  price numeric(8,2) not null,
  cleaning_fee numeric(8,2) not null default 0,
  shipping_fee numeric(8,2) not null default 0,
  service_fee numeric(8,2) not null default 0,
  credit_used numeric(8,2) not null default 0,
  deposit numeric(8,2) not null default 0,
  status text not null default 'demandee' check (status in ('demandee','confirmee','remise','rendue','terminee','refusee','annulee','litige')),
  created_at timestamptz not null default now(),
  check (end_date > start_date),
  check (renter_id <> owner_id)
);
create index if not exists reservations_thread_idx on public.reservations(thread_id);
create index if not exists reservations_item_idx on public.reservations(item_id);

-- ---------- Messages (un fil par colis) ----------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  sender_id uuid references public.profiles(id), -- null = message système
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists messages_thread_idx on public.messages(thread_id, created_at);

-- ---------- Avis ----------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.reservations(id),
  author_id uuid not null references public.profiles(id),
  target_id uuid not null references public.profiles(id),
  rating int not null check (rating between 1 and 5),
  body text default '' check (char_length(body) <= 300),
  created_at timestamptz not null default now()
);

-- ---------- Favoris ----------
create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- =====================================================================
-- Règles d'accès (RLS)
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.reservations enable row level security;
alter table public.messages enable row level security;
alter table public.reviews enable row level security;
alter table public.favorites enable row level security;

-- Participante d'un fil (locataire ou loueuse d'une réservation de ce fil)
create or replace function public.is_thread_member(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.reservations r
                 where r.thread_id = t and auth.uid() in (r.renter_id, r.owner_id));
$$;

-- Profils : lisibles par les membres connectés (prénom, commune, note), modifiables par soi-même
drop policy if exists "profils lisibles" on public.profiles;
create policy "profils lisibles" on public.profiles for select to authenticated using (true);
drop policy if exists "profil modifiable par soi" on public.profiles;
create policy "profil modifiable par soi" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Pièces : en ligne = visibles par tous ; les siennes = visibles et modifiables
drop policy if exists "pieces visibles" on public.items;
create policy "pieces visibles" on public.items for select
  using (status = 'online' or owner_id = auth.uid());
drop policy if exists "pieces ajout" on public.items;
create policy "pieces ajout" on public.items for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "pieces modif" on public.items;
create policy "pieces modif" on public.items for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "pieces suppr" on public.items;
create policy "pieces suppr" on public.items for delete to authenticated using (owner_id = auth.uid());

-- Réservations : visibles par la locataire et la loueuse
-- (la création et les changements d'étape passeront par une fonction serveur avec Stripe ;
--  en attendant, la locataire crée, et les deux parties peuvent faire avancer le statut)
drop policy if exists "resa visibles" on public.reservations;
create policy "resa visibles" on public.reservations for select to authenticated
  using (auth.uid() in (renter_id, owner_id));
drop policy if exists "resa creation" on public.reservations;
create policy "resa creation" on public.reservations for insert to authenticated
  with check (renter_id = auth.uid() and status = 'demandee');
drop policy if exists "resa statut" on public.reservations;
create policy "resa statut" on public.reservations for update to authenticated
  using (auth.uid() in (renter_id, owner_id)) with check (auth.uid() in (renter_id, owner_id));

-- Messages : seulement les participantes du fil
drop policy if exists "messages lecture" on public.messages;
create policy "messages lecture" on public.messages for select to authenticated using (public.is_thread_member(thread_id));
drop policy if exists "messages envoi" on public.messages;
create policy "messages envoi" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_thread_member(thread_id));

-- Avis : publics ; écrits par la locataire d'une location terminée
drop policy if exists "avis lecture" on public.reviews;
create policy "avis lecture" on public.reviews for select using (true);
drop policy if exists "avis ecriture" on public.reviews;
create policy "avis ecriture" on public.reviews for insert to authenticated with check (
  author_id = auth.uid() and exists (
    select 1 from public.reservations r
    where r.id = reservation_id and r.renter_id = auth.uid() and r.status = 'terminee'));

-- Favoris : les siens
drop policy if exists "favoris" on public.favorites;
create policy "favoris" on public.favorites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =====================================================================
-- Stockage des photos : lecture publique, écriture dans son propre dossier
-- (chemin : <id du compte>/<fichier>.jpg)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "photos ajout" on storage.objects;
create policy "photos ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "photos suppression" on storage.objects;
create policy "photos suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- =====================================================================
-- Accès de l'API (les règles RLS ci-dessus restent le vrai verrou)
-- =====================================================================
grant usage on schema public to anon, authenticated;
grant select on public.items, public.reviews to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- =====================================================================
-- v0.4 : messages système et périodes occupées
-- =====================================================================
-- Les messages « système » (sender_id vide) peuvent être ajoutés par les participantes du fil
drop policy if exists "messages envoi" on public.messages;
create policy "messages envoi" on public.messages for insert to authenticated
  with check ((sender_id = auth.uid() or sender_id is null) and public.is_thread_member(thread_id));

-- Périodes où une pièce est déjà réservée, sans dire par qui (pour le calendrier de disponibilité)
create or replace function public.busy_ranges()
returns table(item_id uuid, thread_id uuid, start_date date, end_date date, handover text)
language sql stable security definer set search_path = public as $$
  select item_id, thread_id, start_date, end_date, handover from public.reservations
  where status in ('demandee','confirmee','remise','rendue');
$$;
revoke execute on function public.busy_ranges() from public, anon;
grant execute on function public.busy_ranges() to authenticated;
