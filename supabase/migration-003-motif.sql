-- v0.4.3 : motif ou précision de couleur (ex. « imprimé léopard »)
alter table public.items add column if not exists pattern text not null default '' check (char_length(pattern) <= 60);
