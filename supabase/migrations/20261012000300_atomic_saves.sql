-- Guardado atómico de recetas y franjas del menú. Antes la app hacía varias
-- operaciones seguidas (actualizar, borrar, insertar) y un fallo a mitad dejaba
-- una receta sin ingredientes o una franja a medias. Ahora cada guardado es una
-- sola transacción: o se guarda todo o no se guarda nada.

-- Crea o actualiza una receta con sus ingredientes y pasos.
-- p_ingredients: [{ ingredient_id?, name, category, quantity, unit, notes }]
--   Si no llega ingredient_id, se busca un producto con ese nombre (sin distinguir
--   mayúsculas) y, si no existe, se crea en el catálogo.
-- p_steps: ["paso 1", "paso 2", ...]
create or replace function public.save_recipe(p_recipe_id uuid, p_recipe jsonb, p_ingredients jsonb, p_steps jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_recipe_id uuid := p_recipe_id;
  v_item record;
  v_ingredient_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(trim(p_recipe->>'name'), '') is null then
    raise exception 'Recipe name is required';
  end if;

  if v_recipe_id is null then
    insert into public.recipes (
      user_id, name, description, preparation_minutes, base_servings,
      calories_per_serving, protein_g_per_serving, carbs_g_per_serving,
      fiber_g_per_serving, fat_g_per_serving, sugar_g_per_serving
    ) values (
      v_user_id,
      trim(p_recipe->>'name'),
      nullif(trim(p_recipe->>'description'), ''),
      (p_recipe->>'preparation_minutes')::integer,
      (p_recipe->>'base_servings')::numeric,
      (p_recipe->>'calories_per_serving')::numeric,
      (p_recipe->>'protein_g_per_serving')::numeric,
      (p_recipe->>'carbs_g_per_serving')::numeric,
      (p_recipe->>'fiber_g_per_serving')::numeric,
      (p_recipe->>'fat_g_per_serving')::numeric,
      (p_recipe->>'sugar_g_per_serving')::numeric
    )
    returning id into v_recipe_id;
  else
    update public.recipes set
      name = trim(p_recipe->>'name'),
      description = nullif(trim(p_recipe->>'description'), ''),
      preparation_minutes = (p_recipe->>'preparation_minutes')::integer,
      base_servings = (p_recipe->>'base_servings')::numeric,
      calories_per_serving = (p_recipe->>'calories_per_serving')::numeric,
      protein_g_per_serving = (p_recipe->>'protein_g_per_serving')::numeric,
      carbs_g_per_serving = (p_recipe->>'carbs_g_per_serving')::numeric,
      fiber_g_per_serving = (p_recipe->>'fiber_g_per_serving')::numeric,
      fat_g_per_serving = (p_recipe->>'fat_g_per_serving')::numeric,
      sugar_g_per_serving = (p_recipe->>'sugar_g_per_serving')::numeric,
      updated_at = now()
    where id = v_recipe_id and user_id = v_user_id;

    if not found then
      raise exception 'Recipe not found';
    end if;

    delete from public.recipe_ingredients where recipe_id = v_recipe_id;
    delete from public.recipe_steps where recipe_id = v_recipe_id;
  end if;

  for v_item in
    select item.value, item.position
    from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb)) with ordinality as item(value, position)
  loop
    v_ingredient_id := nullif(v_item.value->>'ingredient_id', '')::uuid;

    if v_ingredient_id is not null then
      if not exists (select 1 from public.ingredients where id = v_ingredient_id and user_id = v_user_id) then
        raise exception 'Invalid product';
      end if;
    else
      if nullif(trim(v_item.value->>'name'), '') is null then
        raise exception 'Product names are required';
      end if;

      select id into v_ingredient_id
      from public.ingredients
      where user_id = v_user_id and lower(name) = lower(trim(v_item.value->>'name'))
      limit 1;

      if v_ingredient_id is null then
        insert into public.ingredients (user_id, name, category, default_unit)
        values (
          v_user_id,
          trim(v_item.value->>'name'),
          coalesce(nullif(v_item.value->>'category', ''), 'Otros'),
          (v_item.value->>'unit')::public.measurement_unit
        )
        returning id into v_ingredient_id;
      end if;
    end if;

    insert into public.recipe_ingredients (recipe_id, ingredient_id, quantity, unit, notes, sort_order)
    values (
      v_recipe_id,
      v_ingredient_id,
      (v_item.value->>'quantity')::numeric,
      (v_item.value->>'unit')::public.measurement_unit,
      nullif(trim(v_item.value->>'notes'), ''),
      v_item.position::integer - 1
    );
  end loop;

  insert into public.recipe_steps (recipe_id, step_number, instruction)
  select v_recipe_id, row_number() over (order by step.position), trim(step.value)
  from jsonb_array_elements_text(coalesce(p_steps, '[]'::jsonb)) with ordinality as step(value, position)
  where nullif(trim(step.value), '') is not null;

  return v_recipe_id;
end;
$$;

-- Guarda una franja del menú. Lo ya consumido no se toca; el resto de filas se
-- sustituye por las que llegan. Si la franja queda vacía y sin consumos, se borra.
-- p_recipes: [{ recipe_id, servings }]  p_products: [{ ingredient_id, quantity, unit }]
-- Devuelve el id de la franja, o null si no queda ninguna.
create or replace function public.save_menu_slot(
  p_planned_date date,
  p_meal public.meal_type,
  p_eating_out boolean,
  p_recipes jsonb,
  p_products jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry_id uuid;
  v_completed_at timestamptz;
  v_consumed_count integer := 0;
  v_locked_recipes integer;
  v_locked_products integer;
  v_planned_count integer;
  v_new_rows integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_recipes, '[]'::jsonb)) as item(value)
    where coalesce((item.value->>'servings')::numeric, 0) <= 0
      or not exists (select 1 from public.recipes r where r.id = (item.value->>'recipe_id')::uuid and r.user_id = v_user_id)
  ) then
    raise exception 'Invalid recipe';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) as item(value)
    where coalesce((item.value->>'quantity')::numeric, 0) <= 0
      or not exists (select 1 from public.ingredients i where i.id = (item.value->>'ingredient_id')::uuid and i.user_id = v_user_id)
  ) then
    raise exception 'Invalid product';
  end if;

  v_new_rows := case when p_eating_out then 0
    else jsonb_array_length(coalesce(p_recipes, '[]'::jsonb)) + jsonb_array_length(coalesce(p_products, '[]'::jsonb)) end;

  select id, completed_at into v_entry_id, v_completed_at
  from public.menu_entries
  where user_id = v_user_id and planned_date = p_planned_date and meal = p_meal
  for update;

  if v_entry_id is null then
    if not p_eating_out and v_new_rows = 0 then
      return null;
    end if;
    insert into public.menu_entries (user_id, planned_date, meal, is_eating_out)
    values (v_user_id, p_planned_date, p_meal, p_eating_out)
    returning id into v_entry_id;
  else
    select count(*) into v_consumed_count from public.consumption_logs where menu_entry_id = v_entry_id;
    if p_eating_out and v_consumed_count > 0 then
      raise exception 'Slot has consumption';
    end if;
    update public.menu_entries set is_eating_out = p_eating_out where id = v_entry_id;
  end if;

  -- Se borran solo las filas que no tienen consumo registrado.
  delete from public.menu_entry_recipes mer
  where mer.menu_entry_id = v_entry_id
    and not exists (select 1 from public.consumption_logs cl where cl.menu_entry_recipe_id = mer.id);
  delete from public.menu_entry_products mep
  where mep.menu_entry_id = v_entry_id
    and not exists (select 1 from public.consumption_logs cl where cl.menu_entry_product_id = mep.id);

  select count(*) into v_locked_recipes from public.menu_entry_recipes where menu_entry_id = v_entry_id;
  select count(*) into v_locked_products from public.menu_entry_products where menu_entry_id = v_entry_id;

  if not p_eating_out then
    insert into public.menu_entry_recipes (menu_entry_id, recipe_id, servings, sort_order)
    select v_entry_id, (item.value->>'recipe_id')::uuid, (item.value->>'servings')::numeric, v_locked_recipes + item.position::integer - 1
    from jsonb_array_elements(coalesce(p_recipes, '[]'::jsonb)) with ordinality as item(value, position);

    insert into public.menu_entry_products (menu_entry_id, ingredient_id, quantity, unit, sort_order)
    select v_entry_id, (item.value->>'ingredient_id')::uuid, (item.value->>'quantity')::numeric, (item.value->>'unit')::public.measurement_unit, v_locked_products + item.position::integer - 1
    from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) with ordinality as item(value, position);
  end if;

  v_planned_count := v_locked_recipes + v_locked_products + v_new_rows;

  if not p_eating_out and v_planned_count = 0 and v_consumed_count = 0 then
    delete from public.menu_entries where id = v_entry_id;
    return null;
  end if;

  update public.menu_entries
  set completed_at = case
    when v_planned_count > 0 and v_consumed_count >= v_planned_count then coalesce(v_completed_at, now())
    else null
  end
  where id = v_entry_id;

  return v_entry_id;
end;
$$;
