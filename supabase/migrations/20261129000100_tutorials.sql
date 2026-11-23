-- Tutoriales: qué tutoriales ha visto (o saltado) cada persona. Se guarda en la
-- cuenta, así que si lo saltas en el móvil tampoco vuelve a salir en el ordenador.
-- * user_settings.tutorials_seen: lista de tutoriales vistos, vacía al principio
--   (también para las cuentas que ya existen: verán cada tutorial una vez).
-- * No modifica ningún dato existente: solo añade una columna vacía y dos funciones.

begin;

alter table public.user_settings
  add column if not exists tutorials_seen text[] not null default '{}';

-- Apunta un tutorial como visto (sin repetirlo). Los nombres son cortos: «menu», «compra-ticket»…
create or replace function public.mark_tutorial_seen(p_tutorial text)
returns text[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_seen text[];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_tutorial is null or p_tutorial !~ '^[a-z][a-z-]{0,39}$' then raise exception 'Invalid tutorial'; end if;
  insert into public.user_settings (user_id, tutorials_seen) values (auth.uid(), array[p_tutorial])
  on conflict (user_id) do update
    set tutorials_seen = case
      when p_tutorial = any(public.user_settings.tutorials_seen) then public.user_settings.tutorials_seen
      else (public.user_settings.tutorials_seen || p_tutorial)[greatest(1, cardinality(public.user_settings.tutorials_seen) - 98):]
    end
  returning tutorials_seen into v_seen;
  return v_seen;
end;
$$;

-- Ayuda → «Volver a ver los tutoriales»: vuelven a salir al entrar en cada pestaña.
create or replace function public.reset_tutorials()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.user_settings set tutorials_seen = '{}' where user_id = auth.uid();
end;
$$;

revoke execute on function public.mark_tutorial_seen(text) from public, anon;
revoke execute on function public.reset_tutorials() from public, anon;
grant execute on function public.mark_tutorial_seen(text) to authenticated;
grant execute on function public.reset_tutorials() to authenticated;

commit;
