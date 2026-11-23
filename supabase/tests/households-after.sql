-- Comprobaciones tras la migración del hogar. Cada fallo para la prueba con un mensaje.
\set ON_ERROR_STOP on
grant all on all tables in schema public to authenticated;

-- 1. No se ha perdido ni una fila.
do $$
declare r record; v_now int;
begin
  for r in select * from public._before loop
    execute format('select count(*) from public.%I', r.name) into v_now;
    assert v_now = r.rows, format('%s: había %s filas y ahora hay %s', r.name, r.rows, v_now);
  end loop;
end $$;

-- 2. Cada cuenta tiene su hogar personal y todas sus filas están en él.
do $$
declare v_table text; v_bad int;
begin
  assert (select count(*) from public.households where personal_for is not null) = 2, 'faltan hogares personales';
  assert (select count(*) from public.household_members where role = 'owner') = 2, 'faltan responsables';
  foreach v_table in array array['ingredients', 'recipes', 'menu_entries', 'pantry_items', 'shopping_lists', 'purchases', 'consumption_logs', 'receipt_aliases'] loop
    execute format('select count(*) from public.%I t join public.households h on h.id = t.household_id where h.personal_for is distinct from t.user_id', v_table) into v_bad;
    assert v_bad = 0, format('%s: %s filas en un hogar que no es el de su dueño', v_table, v_bad);
  end loop;
end $$;

-- 3. Cada cuenta ve exactamente lo suyo.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from public.recipes) = 1 and (select name from public.recipes) = 'Lentejas', 'Ana no ve solo su receta';
  assert (select count(*) from public.purchases) = 1, 'Ana no ve su ticket';
  assert (select count(*) from public.ingredients where name = 'Leche entera') = 1, 'Ana no ve el producto creado por el ticket';
  assert (select count(*) from public.households) = 1, 'Ana ve hogares ajenos';
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select count(*) from public.recipes) = 1 and (select name from public.recipes) = 'Tortilla', 'Beto no ve solo su receta';
  assert (select count(*) from public.purchases) = 0, 'Beto ve tickets ajenos';
  assert (select count(*) from public.menu_entries) = 0, 'Beto ve menús ajenos';
end $$;
reset role;

-- 4. Todas las funciones de la app siguen funcionando, ahora por hogar (como Ana).
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
declare v_recipe uuid; v_entry uuid; v_product_row uuid; v_log uuid; v_purchase uuid; v_item uuid; v_source uuid; v_target uuid; v_spare uuid; v_result jsonb;
begin
  -- Crear producto sin indicar hogar: se rellena solo.
  insert into public.ingredients (name, category, default_unit) values ('Garbanzo pedrosillano', 'Despensa', 'g') returning id into v_source;
  assert (select household_id from public.ingredients where id = v_source) = public.current_household_id(), 'el hogar no se rellena solo';
  assert (select user_id from public.ingredients where id = v_source) = auth.uid(), 'no se apunta quién lo crea';

  v_recipe := public.save_recipe(null, '{"name":"Garbanzos","base_servings":2}',
    jsonb_build_array(jsonb_build_object('ingredient_id', v_source, 'name', 'Garbanzo pedrosillano', 'category', 'Despensa', 'quantity', 150, 'unit', 'g'),
                      jsonb_build_object('ingredient_id', null, 'name', 'Comino nuevo', 'category', 'Salsas y condimentos', 'quantity', 1, 'unit', 'cucharadita')),
    '["Remojar", "Cocer"]');
  assert (select count(*) from public.recipe_ingredients where recipe_id = v_recipe) = 2, 'save_recipe';

  perform public.save_menu_slot('2026-11-24', 'cena', false, jsonb_build_array(jsonb_build_object('recipe_id', v_recipe, 'servings', 2)),
    (select jsonb_build_array(jsonb_build_object('ingredient_id', id, 'quantity', 1, 'unit', 'unidad')) from public.ingredients where name = 'Pan'));
  select id into v_entry from public.menu_entries where planned_date = '2026-11-24' and meal = 'cena';
  assert v_entry is not null, 'save_menu_slot';

  v_result := public.add_to_menu_slots('[{"planned_date":"2026-11-25","meal":"cena"}]', jsonb_build_array(jsonb_build_object('recipe_id', v_recipe, 'servings', 2)), '[]');
  assert (v_result->>'added')::int = 1, 'add_to_menu_slots';

  v_result := public.copy_menu_week('2026-11-23', '2026-11-30', false);
  assert (v_result->>'slots')::int >= 3, format('copy_menu_week: %s', v_result);

  select id into v_product_row from public.menu_entry_products where menu_entry_id = v_entry;
  v_log := public.complete_planned_product(v_product_row, 1, 'unidad');
  assert (select pantry_deducted_quantity from public.consumption_ingredients where consumption_log_id = v_log) = 1, 'complete_planned_product no descontó el pan';
  v_result := public.undo_consumption(v_log);
  assert jsonb_array_length(v_result->'returned') = 1, format('undo_consumption: %s', v_result);

  perform public.regenerate_shopping_list('2026-11-30', (select jsonb_build_array(jsonb_build_object('ingredient_id', id, 'quantity', 2, 'unit', 'unidad')) from public.ingredients where name = 'Limón'));
  assert exists (select 1 from public.shopping_lists where week_start = '2026-11-30'), 'regenerate_shopping_list';

  v_purchase := public.import_reviewed_receipt('Consum', now(), 1.5,
    '[{"raw_name":"PAN","canonical_name":"Pan","normalized_name":"pan","ingredient_id":null,"category":"Panadería","quantity":1,"unit":"unidad","total_price":1.5,"add_to_pantry":true}]');
  assert (select count(*) from public.ingredients where name = 'Pan') = 1, 'el ticket duplicó «Pan»';
  select id into v_item from public.purchase_items where purchase_id = v_purchase;
  perform public.delete_purchase_item_and_reverse_pantry(v_item);
  perform public.delete_purchase_and_reverse_pantry(v_purchase);

  select id into v_target from public.ingredients where name = 'Garbanzos cocidos';
  perform public.merge_ingredients(v_source, v_target);
  assert not exists (select 1 from public.ingredients where id = v_source), 'merge_ingredients';

  insert into public.ingredients (name) values ('Producto sin usar') returning id into v_spare;
  perform public.delete_unused_ingredient(v_spare);
  assert not exists (select 1 from public.ingredients where id = v_spare), 'delete_unused_ingredient';

  assert public.add_basic_ingredients() = 0, 'add_basic_ingredients duplicó básicos';
end $$;
reset role;

-- 5. Un hogar no puede tocar lo de otro.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
declare v_other uuid;
begin
  select i.id into v_other from public.ingredients i where false;  -- Ana no ve productos de Beto
  begin
    insert into public.pantry_items (ingredient_id, quantity, unit)
    select id, 1, 'unidad' from public.ingredients where household_id <> public.current_household_id() limit 1;
  exception when others then null;
  end;
  begin
    insert into public.ingredients (household_id, name) values ((select id from public.households where personal_for = '00000000-0000-0000-0000-00000000000b'), 'Intruso');
    raise exception 'Ana pudo crear un producto en el hogar de Beto';
  exception when insufficient_privilege or check_violation or not_null_violation then null;
  end;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.ingredients where name = 'Intruso'), 'hay un producto intruso';
end $$;
-- Ana intenta fusionar un producto de Beto: no lo encuentra.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
begin
  perform public.merge_ingredients(
    (select id from public.ingredients where name = 'Pan'),
    '00000000-0000-0000-0000-000000000000');
  raise exception 'merge_ingredients aceptó un producto inexistente';
exception when raise_exception then
  if sqlerrm <> 'Ingredient not found' then raise; end if;
end $$;
reset role;

-- 6. Hogar compartido (vista previa de la fase 2): Ana y Beto comparten un hogar.
do $$
declare v_home uuid;
begin
  insert into public.households (name, created_by) values ('Casa', '00000000-0000-0000-0000-00000000000a') returning id into v_home;
  insert into public.household_members (household_id, user_id, role) values
    (v_home, '00000000-0000-0000-0000-00000000000a', 'owner'), (v_home, '00000000-0000-0000-0000-00000000000b', 'member');
  insert into public.user_settings (user_id, active_household_id) values
    ('00000000-0000-0000-0000-00000000000a', v_home), ('00000000-0000-0000-0000-00000000000b', v_home)
  on conflict (user_id) do update set active_household_id = excluded.active_household_id;
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from public.recipes) = 0, 'el hogar compartido no empieza vacío';
  insert into public.ingredients (name) values ('Pan de la casa');
  perform public.add_basic_ingredients();
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select count(*) from public.ingredients where name = 'Pan de la casa') = 1, 'Beto no ve lo que añade Ana en el hogar compartido';
  assert (select count(*) from public.recipes where name = 'Tortilla') = 0, 'en el hogar compartido se ven recetas personales';
end $$;
reset role;
-- Volver al hogar personal: todo sigue ahí.
update public.user_settings set active_household_id = null where user_id = '00000000-0000-0000-0000-00000000000b';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select count(*) from public.recipes where name = 'Tortilla') = 1, 'Beto perdió su receta al volver a su hogar';
  assert (select count(*) from public.ingredients where name = 'Pan de la casa') = 0, 'en el hogar personal se ve lo del compartido';
end $$;
reset role;
-- Si Beto deja de ser miembro, su hogar activo deja de valer y vuelve al personal.
delete from public.household_members where user_id = '00000000-0000-0000-0000-00000000000b' and role = 'member';
update public.user_settings set active_household_id = (select id from public.households where name = 'Casa') where user_id = '00000000-0000-0000-0000-00000000000b';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert public.current_household_id() = (select id from public.households where personal_for = auth.uid()), 'sin ser miembro sigue en el hogar compartido';
end $$;
reset role;

-- 7. Cuenta nueva (con invitación): hogar personal y productos básicos.
do $$
declare v_code text;
begin
  insert into public.app_invites (code, created_by) values ('NUEVA234', '00000000-0000-0000-0000-00000000000a');
  insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000c', 'carla@prueba.es', '{"invite_code":"NUEVA234"}');
  assert (select count(*) from public.ingredients i join public.households h on h.id = i.household_id where h.personal_for = '00000000-0000-0000-0000-00000000000c') = 123,
    'la cuenta nueva no tiene sus productos básicos';
end $$;

-- 8. Borrar una cuenta no borra datos del hogar: solo se pierde quién los hizo.
do $$
declare v_before int;
begin
  select count(*) into v_before from public.ingredients;
  delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
  assert (select count(*) from public.ingredients) = v_before, 'borrar la cuenta borró productos';
  assert (select count(*) from public.ingredients where name = 'Pan de la casa' and user_id is null) = 1, 'no se conservó el producto del hogar compartido';
end $$;

select 'OK: todas las comprobaciones del hogar pasan' as resultado;
