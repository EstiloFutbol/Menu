-- Tras aplicar las migraciones posteriores a la fase 1 (fase 2 del hogar, modo
-- sencillo…) a una base de datos como la de producción: las cuentas
-- que ya existen no pierden ni cambian NADA y siguen viendo lo mismo.
\set ON_ERROR_STOP on

-- 1. Ninguna fila desaparece ni cambia en ninguna tabla. Se ignoran solo las columnas
--    nuevas, que quedan vacías: household_id en app_invites y tutorials_seen en user_settings.
do $$
declare r record; v_rows int; v_hash text;
begin
  for r in select * from public._fingerprint loop
    execute format('select count(*) from public.%I', r.name) into v_rows;
    assert v_rows = r.rows, format('%s: había %s filas y ahora hay %s', r.name, r.rows, v_rows);
    if r.name = 'app_invites' then
      execute 'select md5(coalesce(string_agg(r, ''|'' order by r), '''')) from (select (to_jsonb(x) - ''household_id'' - ''tutorials_seen'')::text as r from public.app_invites x) s' into v_hash;
    else
      execute format('select md5(coalesce(string_agg(r, ''|'' order by r), '''')) from (select (to_jsonb(x) - ''household_id'' - ''tutorials_seen'')::text as r from public.%I x) s', r.name) into v_hash;
    end if;
    assert v_hash = r.hash, format('%s: ha cambiado el contenido', r.name);
  end loop;
  assert (select count(*) from public.app_invites where household_id is not null) = 0, 'alguna invitación antigua cambió de tipo';
end $$;

-- 2. Cada cuenta sigue en su hogar personal, como responsable, viendo sus datos,
--    con sus preferencias y su invitación sin usar todavía válida.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from public.my_households()) = 1, 'Ana no tiene un solo hogar';
  assert (select count(*) from public.my_households() where is_personal and is_current and role = 'owner') = 1, 'Ana no está en su hogar personal como responsable';
  assert (select count(*) from public.recipes where name = 'Lentejas') = 1, 'Ana no ve su receta';
  assert (select count(*) from public.purchases) = 1, 'Ana no ve su ticket';
  assert (select count(*) from public.menu_entries) = 1, 'Ana no ve su menú';
  assert (select default_servings from public.household_settings) = 3 and (select week_starts_on from public.household_settings) = 0, 'Ana perdió sus preferencias';
  assert (select count(*) from public.household_member_list(public.current_household_id())) = 1, 'en el hogar de Ana aparece alguien más';
  assert (select mode from public.household_settings) = 'completo', 'Ana no sigue en modo completo';
  assert (select tutorials_seen from public.user_settings) = '{}', 'Ana tiene tutoriales vistos que no ha visto';
  assert (select count(*) from public.menu_day_notes) = 0 and (select count(*) from public.quick_list_items) = 0, 'aparecen notas o apuntes que nadie escribió';
end $$;
reset role;
do $$ begin
  assert public.check_app_invite('ANAAPP23'), 'la invitación sin usar de Ana dejó de valer';
  assert not public.check_app_invite('ANAUSO23'), 'la invitación usada vuelve a valer';
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select count(*) from public.my_households() where is_personal and is_current and role = 'owner') = 1, 'Beto no está en su hogar personal';
  assert (select count(*) from public.recipes where name = 'Tortilla') = 1 and (select count(*) from public.recipes) = 1, 'Beto no ve exactamente su receta';
  assert (select count(*) from public.pantry_items) = 1, 'Beto no ve su despensa';
  -- Sin preferencias guardadas: la app usa las de siempre (2 raciones, semana en lunes, todas las comidas).
  assert (select count(*) from public.household_settings) = 0, 'Beto tiene preferencias que no guardó';
end $$;
reset role;


select 'OK: las cuentas actuales no pierden ni cambian nada con las migraciones nuevas' as resultado;
