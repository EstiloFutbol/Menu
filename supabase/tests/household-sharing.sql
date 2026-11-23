-- Fase 2 del hogar: invitar, unirse, cambiar, salir y quitar a alguien.
-- Se ejecuta sobre una base de datos vacía con TODAS las migraciones aplicadas.
-- Garantía principal: ninguna de estas acciones borra datos.
\set ON_ERROR_STOP on
grant usage on schema public to authenticated, anon;
grant all on all tables in schema public to authenticated;

-- Ana y Beto ya tienen cuenta (creadas desde el panel, sin invitación).
alter table auth.users disable trigger before_auth_user_created_require_invite;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@prueba.es'),
  ('00000000-0000-0000-0000-00000000000b', 'beto@prueba.es'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@prueba.es');
alter table auth.users enable trigger before_auth_user_created_require_invite;

-- Recuento de todas las tablas de datos, para comprobar que nunca baja.
create table public._snap (name text primary key, rows int);
create function public._count_rows() returns table (name text, rows int) language plpgsql as $$
declare v_table text;
begin
  foreach v_table in array array['households', 'ingredients', 'recipes', 'recipe_ingredients', 'recipe_steps', 'menu_entries', 'menu_entry_recipes',
    'menu_entry_products', 'pantry_items', 'shopping_lists', 'shopping_items', 'purchases', 'purchase_items', 'consumption_logs',
    'consumption_ingredients', 'receipt_aliases', 'household_settings', 'user_settings', 'menu_day_notes', 'quick_list_items', 'app_invites'] loop
    name := v_table;
    execute format('select count(*) from public.%I', v_table) into rows;
    return next;
  end loop;
end $$;
create function public._nothing_lost(p_label text) returns void language plpgsql as $$
declare r record;
begin
  for r in select c.name, c.rows, s.rows as before from public._count_rows() c left join public._snap s using (name) loop
    assert r.rows >= coalesce(r.before, 0), format('%s: %s bajó de %s a %s filas', p_label, r.name, r.before, r.rows);
  end loop;
  delete from public._snap;
  insert into public._snap select * from public._count_rows();
end $$;
select public._nothing_lost('inicio');

-- Datos de partida: Ana tiene una receta y sus preferencias; Beto, su tortilla.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.save_recipe(null, '{"name":"Lentejas","base_servings":2}',
  (select jsonb_agg(jsonb_build_object('ingredient_id', id, 'name', name, 'category', category, 'quantity', 100, 'unit', 'g')) from public.ingredients where name in ('Lentejas', 'Cebolla')),
  '["Cocer"]');
insert into public.household_settings (default_servings, week_starts_on) values (4, 0);
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.save_recipe(null, '{"name":"Tortilla","base_servings":2}',
  (select jsonb_agg(jsonb_build_object('ingredient_id', id, 'name', name, 'category', category, 'quantity', 4, 'unit', 'unidad')) from public.ingredients where name = 'Huevos'),
  '["Batir"]');
reset role;
select public._nothing_lost('datos de partida');

-- 1. Invitar: solo el responsable invita a su hogar; un código de la app no sirve para unirse.
create table public._codes (name text primary key, code text);
grant all on public._codes to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
declare v_invite public.app_invites;
begin
  v_invite := public.create_app_invite('household');
  assert v_invite.kind = 'household' and v_invite.household_id = public.current_household_id(), 'la invitación no es al hogar de Ana';
  insert into public._codes values ('hogar', v_invite.code);
  v_invite := public.create_app_invite();
  assert v_invite.kind = 'app' and v_invite.household_id is null, 'la invitación a la app lleva hogar';
  insert into public._codes values ('app', v_invite.code);
  begin
    perform public.create_app_invite('otra');
    raise exception 'aceptó un tipo de invitación inventado';
  exception when raise_exception then
    if sqlerrm <> 'Invalid invite kind' then raise; end if;
  end;
end $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  begin
    perform public.join_household((select code from public._codes where name = 'app'));
    raise exception 'un código de la app sirvió para unirse a un hogar';
  exception when raise_exception then
    if sqlerrm <> 'Invalid invite code' then raise; end if;
  end;
  begin
    perform public.join_household('ZZZZ-ZZZZ');
    raise exception 'un código inventado sirvió';
  exception when raise_exception then
    if sqlerrm <> 'Invalid invite code' then raise; end if;
  end;
end $$;
reset role;

-- 2. Beto se une (con el código escrito en minúsculas y con guion) y pasa a ver el hogar de Ana.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
declare v_home uuid; v_code text := (select code from public._codes where name = 'hogar');
begin
  v_home := public.join_household(lower(left(v_code, 4) || '-' || right(v_code, 4)));
  assert public.current_household_id() = v_home, 'Beto no ve el hogar al que se ha unido';
  assert (select count(*) from public.recipes where name = 'Lentejas') = 1, 'Beto no ve las recetas del hogar';
  assert (select count(*) from public.recipes where name = 'Tortilla') = 0, 'en el hogar de Ana aparece la receta personal de Beto';
  assert (select count(*) from public.my_households()) = 2, 'Beto no ve sus dos hogares';
  assert (select count(*) from public.my_households() where is_current and not is_personal and role = 'member') = 1, 'el hogar actual de Beto no es el de Ana';
  assert (select array_agg(email order by email) from public.household_member_list(v_home)) = array['ana@prueba.es', 'beto@prueba.es'], 'no se ven las personas del hogar';
  assert (select email from public.household_member_list(v_home) where role = 'owner') = 'ana@prueba.es', 'Ana no es la responsable';
  assert (select default_servings from public.household_settings) = 4, 'Beto no ve las preferencias del hogar';
  -- El código ya está usado.
  begin
    perform public.join_household(v_code);
    raise exception 'un código usado sirvió otra vez';
  exception when raise_exception then
    if sqlerrm <> 'Invalid invite code' then raise; end if;
  end;
  -- Solo el responsable invita y cambia el nombre.
  begin
    perform public.create_app_invite('household');
    raise exception 'un miembro pudo invitar al hogar';
  exception when raise_exception then
    if sqlerrm <> 'Only the household owner can invite' then raise; end if;
  end;
  begin
    perform public.rename_household(v_home, 'Mi casa');
    raise exception 'un miembro pudo cambiar el nombre';
  exception when raise_exception then
    if sqlerrm <> 'Only the household owner can rename it' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  assert (select used_email from public.app_invites where kind = 'household') = 'beto@prueba.es', 'no se apunta quién usó la invitación';
end $$;
select public._nothing_lost('unirse');

-- 3. Carla, que no es del hogar, no ve nada de él ni puede entrar.
insert into public._codes select 'hogar de Ana', id::text from public.households where personal_for = '00000000-0000-0000-0000-00000000000a';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$
declare v_home uuid := (select code::uuid from public._codes where name = 'hogar de Ana');
begin
  assert v_home is not null, 'falta el hogar de Ana para la prueba';
  assert (select count(*) from public.household_member_list(v_home)) = 0, 'Carla ve las personas de un hogar ajeno';
  assert (select count(*) from public.recipes where name = 'Lentejas') = 0, 'Carla ve recetas ajenas';
  assert (select count(*) from public.households) = 1, 'Carla ve hogares ajenos';
  begin
    perform public.switch_household(v_home);
    raise exception 'Carla pudo cambiarse a un hogar ajeno';
  exception when raise_exception then
    if sqlerrm <> 'Not a member of this household' then raise; end if;
  end;
  begin
    perform public.remove_household_member(v_home, '00000000-0000-0000-0000-00000000000b');
    raise exception 'Carla pudo quitar a alguien de un hogar ajeno';
  exception when raise_exception then
    if sqlerrm <> 'Only the household owner can remove members' then raise; end if;
  end;
  update public.household_settings set default_servings = 9;
  assert not found, 'Carla cambió las preferencias de otro hogar';
  -- Tampoco puede fabricarse una invitación a ese hogar escribiendo en la tabla.
  begin
    insert into public.app_invites (code, created_by, kind, household_id) values ('CARLA234', auth.uid(), 'household', v_home);
    raise exception 'Carla se creó una invitación a un hogar ajeno';
  exception when insufficient_privilege then null;
  end;
  insert into public.app_invites (code, created_by) values ('CARLA567', auth.uid());
  begin
    update public.app_invites set kind = 'household', household_id = v_home where code = 'CARLA567';
    raise exception 'Carla convirtió su invitación en una a un hogar ajeno';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 4. En el hogar compartido, Beto añade una receta, un ticket (que suma a la despensa) y lo que ve Ana.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.save_recipe(null, '{"name":"Paella","base_servings":4}',
  jsonb_build_array(
    jsonb_build_object('ingredient_id', null, 'name', 'Arroz bomba especial', 'category', 'Despensa', 'quantity', 400, 'unit', 'g'),
    jsonb_build_object('ingredient_id', (select id from public.ingredients where name = 'Huevos'), 'name', 'Huevos', 'category', 'Lácteos y huevos', 'quantity', 2, 'unit', 'unidad')),
  '["Sofreír", "Cocer el arroz"]');
select public.import_reviewed_receipt('Mercadona', now(), 3.5,
  '[{"raw_name":"ARROZ BOMBA ESP","canonical_name":"Arroz bomba especial","normalized_name":"arroz bomba esp","ingredient_id":null,"category":"Despensa","quantity":1,"unit":"kg","total_price":3.5,"add_to_pantry":true}]');
update public.household_settings set visible_meals = '{comida,cena}';
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from public.recipes where name = 'Paella') = 1, 'Ana no ve la receta que añadió Beto';
  assert (select count(*) from public.purchases) = 1, 'Ana no ve el ticket de Beto';
  assert (select visible_meals from public.household_settings) = '{comida,cena}', 'Ana no ve las preferencias que cambió Beto';
end $$;
reset role;
select public._nothing_lost('añadir en el hogar compartido');

-- 5. Cambiar de hogar solo cambia lo que se ve; se puede ir y volver.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
declare v_home uuid := public.current_household_id(); v_personal uuid := (select id from public.my_households() where is_personal);
begin
  perform public.switch_household(v_personal);
  assert (select count(*) from public.recipes where name = 'Tortilla') = 1 and (select count(*) from public.recipes where name = 'Paella') = 0, 'el hogar personal no se ve igual que antes';
  assert (select default_servings from public.household_settings) is null, 'el hogar personal de Beto tiene preferencias de otro';
  perform public.switch_household(v_home);
  assert (select count(*) from public.recipes where name = 'Paella') = 1, 'al volver al hogar compartido falta la receta';
end $$;
reset role;
select public._nothing_lost('cambiar de hogar');

-- 6. Del hogar personal no se puede salir ni echar a su dueña.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
declare v_home uuid := public.current_household_id();
begin
  begin
    perform public.leave_household(v_home, false);
    raise exception 'Ana pudo salir de su hogar personal';
  exception when raise_exception then
    if sqlerrm <> 'Cannot leave the personal household' then raise; end if;
  end;
  begin
    perform public.remove_household_member(v_home, auth.uid());
    raise exception 'Ana pudo quitarse a sí misma';
  exception when raise_exception then
    if sqlerrm <> 'Use leave_household to leave' then raise; end if;
  end;
  perform public.rename_household(v_home, '  Casa  ');
  assert (select name from public.households where id = v_home) = 'Casa', 'no se cambió el nombre';
end $$;
reset role;

-- 7. Beto sale llevándose una copia: recetas, ticket y traducciones; los productos no se duplican.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
declare v_home uuid := public.current_household_id(); v_products int; v_result jsonb;
begin
  -- Productos del hogar personal antes de salir (las políticas solo dejan ver los del hogar actual).
  perform public.switch_household((select id from public.my_households() where is_personal));
  select count(*) into v_products from public.ingredients;
  perform public.switch_household(v_home);
  v_result := public.leave_household(v_home, true);
  assert v_result = '{"products": 1, "recipes": 1, "purchases": 1, "aliases": 1}'::jsonb, format('copia inesperada: %s', v_result);
  assert public.current_household_id() = (select id from public.households where personal_for = auth.uid()), 'Beto no vuelve a su hogar personal';
  assert (select count(*) from public.my_households()) = 1, 'Beto sigue en el hogar de Ana';
  assert (select count(*) from public.ingredients) = v_products + 1, 'se duplicaron productos al copiar';
  assert (select count(*) from public.ingredients where name in ('Huevos', 'Arroz bomba especial')) = 2, 'productos repetidos tras copiar';
  assert (select count(*) from public.recipes where name = 'Paella') = 1, 'no se copió la receta';
  assert (select count(*) from public.recipe_ingredients ri join public.recipes r on r.id = ri.recipe_id where r.name = 'Paella') = 2, 'faltan ingredientes de la receta copiada';
  assert (select count(*) from public.recipe_steps s join public.recipes r on r.id = s.recipe_id where r.name = 'Paella') = 2, 'faltan pasos de la receta copiada';
  assert (select count(*) from public.recipe_ingredients ri join public.ingredients i on i.id = ri.ingredient_id
          where i.household_id <> public.current_household_id()) = 0, 'la receta copiada usa productos de otro hogar';
  assert (select count(*) from public.purchase_items where pantry_effect_applied) = 0, 'la compra copiada cree que sumó a la despensa';
  assert (select count(*) from public.pantry_items pi join public.ingredients i on i.id = pi.ingredient_id where i.name = 'Arroz bomba especial') = 0, 'copiar la compra tocó la despensa';
  assert (select count(*) from public.receipt_aliases where normalized_name = 'arroz bomba esp') = 1, 'no se copió la traducción del ticket';
  begin
    perform public.leave_household(v_home, true);
    raise exception 'Beto pudo salir de un hogar en el que ya no está';
  exception when raise_exception then
    if sqlerrm <> 'Not a member of this household' then raise; end if;
  end;
end $$;
-- Borrar la compra copiada no resta nada de la despensa.
do $$
declare v_pantry numeric;
begin
  select coalesce(sum(quantity), 0) into v_pantry from public.pantry_items;
  perform public.delete_purchase_and_reverse_pantry((select id from public.purchases));
  assert (select coalesce(sum(quantity), 0) from public.pantry_items) = v_pantry, 'borrar la compra copiada cambió la despensa';
end $$;
reset role;
-- Lo que añadió Beto se queda en el hogar de Ana.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from public.recipes where name = 'Paella') = 1, 'al salir Beto, el hogar perdió su receta';
  assert (select count(*) from public.purchases) = 1, 'al salir Beto, el hogar perdió su ticket';
  assert (select count(*) from public.pantry_items pi join public.ingredients i on i.id = pi.ingredient_id where i.name = 'Arroz bomba especial') = 1, 'al salir Beto, la despensa perdió lo comprado';
  assert (select count(*) from public.household_member_list(public.current_household_id())) = 1, 'Beto sigue apareciendo en el hogar';
end $$;
reset role;
-- La única fila que baja es la compra que Beto borró a propósito en su hogar personal.
delete from public._snap where name in ('purchases', 'purchase_items');
select public._nothing_lost('salir con copia');

-- 8. Vuelve a entrar y sale otra vez con copia: la receta repetida lleva el nombre del hogar.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public._codes set code = (public.create_app_invite('household')).code where name = 'hogar';
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
declare v_home uuid;
begin
  v_home := public.join_household((select code from public._codes where name = 'hogar'));
  perform public.leave_household(v_home, true);
  assert (select count(*) from public.recipes where name = 'Paella (de Casa)') = 1, 'la segunda copia no lleva el nombre del hogar';
  assert (select count(*) from public.recipes where name = 'Paella') = 1, 'la primera copia cambió';
end $$;
reset role;
select public._nothing_lost('salir con copia otra vez');

-- 9. Salir sin copia no cambia el hogar personal; quitar a alguien tampoco borra nada.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public._codes set code = (public.create_app_invite('household')).code where name = 'hogar';
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
declare v_home uuid; v_recipes int;
begin
  select count(*) into v_recipes from public.recipes;
  v_home := public.join_household((select code from public._codes where name = 'hogar'));
  assert public.leave_household(v_home, false) = '{}'::jsonb, 'salir sin copia copió algo';
  assert (select count(*) from public.recipes) = v_recipes, 'salir sin copia cambió las recetas personales';
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public._codes set code = (public.create_app_invite('household')).code where name = 'hogar';
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.join_household((select code from public._codes where name = 'hogar'));
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  perform public.remove_household_member(public.current_household_id(), '00000000-0000-0000-0000-00000000000b');
  assert (select count(*) from public.household_member_list(public.current_household_id())) = 1, 'Beto sigue en el hogar';
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert public.current_household_id() = (select id from public.households where personal_for = auth.uid()), 'al quitar a Beto no vuelve a su hogar personal';
  assert (select count(*) from public.recipes where name = 'Tortilla') = 1, 'Beto perdió su receta personal';
end $$;
reset role;
select public._nothing_lost('salir sin copia y quitar a alguien');

-- 10. Cuenta nueva con invitación a un hogar: entra directamente en él y tiene su hogar personal.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public._codes set code = (public.create_app_invite('household')).code where name = 'hogar';
reset role;
do $$
declare v_dani uuid := '00000000-0000-0000-0000-00000000000d';
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_dani, 'dani@prueba.es', jsonb_build_object('invite_code', (select code from public._codes where name = 'hogar')));
  assert (select count(*) from public.household_members where user_id = v_dani) = 2, 'Dani no está en su hogar y en el de Ana';
  assert (select h.personal_for from public.user_settings s join public.households h on h.id = s.active_household_id where s.user_id = v_dani)
    = '00000000-0000-0000-0000-00000000000a', 'Dani no entra directamente en el hogar de Ana';
  assert (select count(*) from public.ingredients i join public.households h on h.id = i.household_id where h.personal_for = v_dani) = 123,
    'Dani no tiene sus productos básicos';
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
do $$ begin
  assert (select count(*) from public.recipes where name = 'Lentejas') = 1, 'Dani no ve las recetas del hogar de Ana';
end $$;
reset role;
-- Un código de la app sigue creando una cuenta con solo su hogar personal.
do $$
declare v_eva uuid := '00000000-0000-0000-0000-00000000000e';
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_eva, 'eva@prueba.es', jsonb_build_object('invite_code', (select code from public._codes where name = 'app')));
  assert (select count(*) from public.household_members where user_id = v_eva) = 1, 'Eva entró en un hogar ajeno';
end $$;
select public._nothing_lost('cuentas nuevas');

-- 11. Si sale el responsable de un hogar (no personal), pasa a serlo quien lleve más tiempo.
do $$
declare v_shared uuid;
begin
  insert into public.households (name, created_by) values ('Piso', '00000000-0000-0000-0000-00000000000a') returning id into v_shared;
  insert into public.household_members (household_id, user_id, role, joined_at) values
    (v_shared, '00000000-0000-0000-0000-00000000000a', 'owner', now() - interval '3 days'),
    (v_shared, '00000000-0000-0000-0000-00000000000c', 'member', now() - interval '2 days'),
    (v_shared, '00000000-0000-0000-0000-00000000000d', 'member', now() - interval '1 day');
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.leave_household((select id from public.households where name = 'Piso'), false);
reset role;
do $$ begin
  assert (select user_id from public.household_members m join public.households h on h.id = m.household_id where h.name = 'Piso' and role = 'owner')
    = '00000000-0000-0000-0000-00000000000c', 'el hogar se quedó sin responsable';
end $$;
select public._nothing_lost('sale el responsable');

-- 12. Modo sencillo: notas del menú y lista a mano, por hogar.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
declare v_result jsonb;
begin
  insert into public.menu_day_notes (day, text) values ('2026-11-23', 'Lentejas y fruta'), ('2026-11-24', ''), ('2026-11-25', 'Tortilla');
  assert (select household_id from public.menu_day_notes where day = '2026-11-23') = public.current_household_id(), 'la nota no es del hogar';
  assert (select updated_by from public.menu_day_notes where day = '2026-11-23') = auth.uid(), 'no se apunta quién escribió la nota';
  insert into public.quick_list_items (text, position) values ('Pan', 1), ('Leche', 2);
  -- La semana siguiente ya tiene algo el miércoles: no se sobrescribe.
  insert into public.menu_day_notes (day, text) values ('2026-12-02', 'Pizza');
  v_result := public.copy_day_notes('2026-11-23', '2026-11-30');
  assert v_result = '{"copied": 1, "kept": 1}'::jsonb, format('copia de semana inesperada: %s', v_result);
  assert (select text from public.menu_day_notes where day = '2026-11-30') = 'Lentejas y fruta', 'no se copió el lunes';
  assert (select text from public.menu_day_notes where day = '2026-12-02') = 'Pizza', 'se sobrescribió un día con texto';
  assert not exists (select 1 from public.menu_day_notes where day = '2026-12-01'), 'se copió un día vacío';
  begin
    insert into public.quick_list_items (text) values ('   ');
    raise exception 'se aceptó un apunte vacío';
  exception when check_violation then null;
  end;
end $$;
reset role;
-- Dani (del hogar de Ana) ve y cambia lo mismo; Eva (otro hogar) no ve nada.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
do $$ begin
  assert (select count(*) from public.menu_day_notes where trim(text) <> '') = 4, 'Dani no ve las notas del hogar';
  update public.quick_list_items set checked = true where text = 'Pan';
  assert found, 'Dani no puede marcar lo comprado';
  assert (select updated_by from public.quick_list_items where text = 'Pan') = auth.uid(), 'no se apunta quién lo marcó';
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
do $$ begin
  assert (select count(*) from public.menu_day_notes) = 0 and (select count(*) from public.quick_list_items) = 0, 'Eva ve notas o apuntes de otro hogar';
  update public.quick_list_items set text = 'Intruso';
  assert not found, 'Eva cambió apuntes de otro hogar';
  begin
    insert into public.menu_day_notes (household_id, day, text) values ((select code::uuid from public._codes where name = 'hogar de Ana'), '2026-11-26', 'Intruso');
    raise exception 'Eva escribió una nota en otro hogar';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 13. Cambiar de modo, varias veces, no toca ningún otro dato.
create table public._modes as
select t.name, (xpath('/row/h/text()', query_to_xml(format(
  'select md5(coalesce(string_agg(r, ''|'' order by r), '''')) as h from (select (to_jsonb(x) - ''mode'' - ''updated_at'' - ''updated_by'')::text as r from public.%I x) s', t.name), false, true, '')))[1]::text as hash
from public._count_rows() t;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  insert into public.household_settings (mode) values ('sencillo') on conflict (household_id) do update set mode = excluded.mode;
  assert (select mode from public.household_settings) = 'sencillo', 'no se cambió al modo sencillo';
  update public.household_settings set mode = 'completo';
  update public.household_settings set mode = 'sencillo';
  update public.household_settings set mode = 'completo';
  begin
    update public.household_settings set mode = 'otro';
    raise exception 'se aceptó un modo inventado';
  exception when check_violation then null;
  end;
end $$;
reset role;
do $$
declare r record; v_hash text;
begin
  for r in select * from public._modes loop
    execute format('select md5(coalesce(string_agg(r, ''|'' order by r), '''')) from (select (to_jsonb(x) - ''mode'' - ''updated_at'' - ''updated_by'')::text as r from public.%I x) s', r.name) into v_hash;
    assert v_hash = r.hash, format('cambiar de modo cambió %s', r.name);
  end loop;
end $$;
select public._nothing_lost('modo sencillo');

-- 14. Cambios en vivo: las tablas compartidas están en la publicación de Realtime.
do $$ begin
  assert (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
          and tablename in ('shopping_items', 'quick_list_items', 'menu_entries', 'menu_day_notes', 'pantry_items', 'consumption_logs', 'household_settings', 'household_members')) = 8,
    'faltan tablas en la publicación de Realtime';
end $$;

-- 15. Tutoriales vistos: por cuenta, sin repetir, y nadie ve los de otro.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
do $$ begin
  assert public.mark_tutorial_seen('menu') = '{menu}', 'no se apuntó el primer tutorial';
  perform public.mark_tutorial_seen('compra-ticket');
  assert public.mark_tutorial_seen('menu') = '{menu,compra-ticket}', 'se repitió un tutorial';
  begin
    perform public.mark_tutorial_seen('<script>');
    raise exception 'se aceptó un nombre de tutorial raro';
  exception when raise_exception then
    if sqlerrm <> 'Invalid tutorial' then raise; end if;
  end;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select coalesce(tutorials_seen, '{}') from public.user_settings) = '{}', 'Ana ve tutoriales de otra cuenta';
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
do $$ begin
  perform public.reset_tutorials();
  assert (select tutorials_seen from public.user_settings) = '{}', 'no se reiniciaron los tutoriales';
end $$;
reset role;

select 'OK: compartir el hogar, el modo sencillo, los cambios en vivo y los tutoriales no pierden nada' as resultado;
