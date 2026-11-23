-- Aïlo v0.8.1 : prévenir une loueuse quand quelqu'un la suit. Rejouable.
create or replace function public.notify_new_follower() returns trigger
language plpgsql security definer set search_path = public as $$
declare s text;
begin
  select value into s from public.app_secrets where key = 'hook_secret';
  if s is null then return new; end if;
  perform net.http_post(
    url := 'https://yiiwwnrayhestpozgckv.supabase.co/functions/v1/ailo/followed',
    body := jsonb_build_object('follower_id', new.follower_id, 'followed_id', new.followed_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ailo-hook', s),
    timeout_milliseconds := 5000);
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists follows_notify on public.follows;
create trigger follows_notify after insert on public.follows
  for each row execute function public.notify_new_follower();
