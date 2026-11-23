-- =====================================================================
-- Aïlo v0.10.3 : qui peut faire avancer une location, contrôlé par la base. Rejouable.
--   loueuse   : accepter, refuser, vêtement remis, vêtement rendu, rendre la caution, litige
--   locataire : payer (bêta), annuler avant la remise
--   serveur (Stripe) : tout
-- =====================================================================
create or replace function public.guard_transitions() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); ok boolean := false;
begin
  if me is null or new.status = old.status then return new; end if;
  if me = old.owner_id then
    ok := (old.status = 'demandee' and new.status in ('acceptee', 'confirmee', 'refusee'))
       or (old.status = 'confirmee' and new.status = 'remise')
       or (old.status = 'remise' and new.status = 'rendue')
       or (old.status = 'rendue' and new.status in ('terminee', 'litige'))
       or (old.status = 'litige' and new.status = 'terminee');
  end if;
  if not ok and me = old.renter_id then
    ok := (old.status = 'acceptee' and new.status = 'confirmee')
       or (old.status in ('demandee', 'acceptee', 'confirmee') and new.status = 'annulee')
       -- réservation instantanée : la locataire passe directement sa propre demande à « acceptée »
       or (old.status = 'demandee' and new.status in ('acceptee', 'confirmee')
           and not exists (select 1 from public.items i where i.id = old.item_id and i.instant = false));
  end if;
  if not ok then
    raise exception 'Cette étape doit être confirmée par l''autre personne.';
  end if;
  return new;
end $$;
drop trigger if exists reservations_guard_transitions on public.reservations;
create trigger reservations_guard_transitions before update on public.reservations
  for each row execute function public.guard_transitions();
