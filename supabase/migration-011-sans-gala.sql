-- Aïlo v0.10.5 : l'occasion « Gala » rejoint « Cocktail ». Rejouable.
update public.items
set occasions = (select array_agg(distinct o) from unnest(array_replace(occasions, 'Gala', 'Cocktail')) as o)
where 'Gala' = any(occasions);
select count(*) as pieces_avec_gala from public.items where 'Gala' = any(occasions);
