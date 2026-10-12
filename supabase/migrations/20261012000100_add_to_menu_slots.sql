-- Añade recetas y productos a varias franjas del menú en una sola transacción.
-- Las franjas que no existen se crean; lo que ya hay en cada franja se conserva.
-- Las franjas marcadas como "Comida fuera" se omiten y se devuelven en `skipped`.
create or replace function public.add_to_menu_slots(p_slots jsonb, p_recipes jsonb, p_products jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_slot record;
  v_entry_id uuid;
  v_eating_out boolean;
  v_recipe_order integer;
  v_product_order integer;
  v_added integer := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_array_length(coalesce(p_recipes, '[]'::jsonb)) + jsonb_array_length(coalesce(p_products, '[]'::jsonb)) = 0 then
    raise exception 'Nothing to add';
  end if;

  -- Solo se aceptan recetas y productos del propio usuario.
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_recipes, '[]'::jsonb)) as item(recipe_id uuid, servings numeric)
    where item.servings is null or item.servings <= 0
      or not exists (select 1 from public.recipes r where r.id = item.recipe_id and r.user_id = v_user_id)
  ) then
    raise exception 'Invalid recipe';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_products, '[]'::jsonb)) as item(ingredient_id uuid, quantity numeric, unit public.measurement_unit)
    where item.quantity is null or item.quantity <= 0 or item.unit is null
      or not exists (select 1 from public.ingredients i where i.id = item.ingredient_id and i.user_id = v_user_id)
  ) then
    raise exception 'Invalid product';
  end if;

  for v_slot in
    select distinct slot.planned_date, slot.meal
    from jsonb_to_recordset(p_slots) as slot(planned_date date, meal public.meal_type)
  loop
    insert into public.menu_entries (user_id, planned_date, meal)
    values (v_user_id, v_slot.planned_date, v_slot.meal)
    on conflict (user_id, planned_date, meal) do nothing;

    select id, is_eating_out into v_entry_id, v_eating_out
    from public.menu_entries
    where user_id = v_user_id and planned_date = v_slot.planned_date and meal = v_slot.meal;

    if v_eating_out then
      v_skipped := v_skipped || jsonb_build_object('planned_date', v_slot.planned_date, 'meal', v_slot.meal);
      continue;
    end if;

    select coalesce(max(sort_order) + 1, 0) into v_recipe_order from public.menu_entry_recipes where menu_entry_id = v_entry_id;
    select coalesce(max(sort_order) + 1, 0) into v_product_order from public.menu_entry_products where menu_entry_id = v_entry_id;

    insert into public.menu_entry_recipes (menu_entry_id, recipe_id, servings, sort_order)
    select v_entry_id, (item.value->>'recipe_id')::uuid, (item.value->>'servings')::numeric, v_recipe_order + item.position::integer - 1
    from jsonb_array_elements(coalesce(p_recipes, '[]'::jsonb)) with ordinality as item(value, position);

    insert into public.menu_entry_products (menu_entry_id, ingredient_id, quantity, unit, sort_order)
    select v_entry_id, (item.value->>'ingredient_id')::uuid, (item.value->>'quantity')::numeric, (item.value->>'unit')::public.measurement_unit, v_product_order + item.position::integer - 1
    from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) with ordinality as item(value, position);

    -- La franja tiene filas nuevas sin consumir, así que deja de estar completada.
    update public.menu_entries set completed_at = null where id = v_entry_id and completed_at is not null;

    v_added := v_added + 1;
  end loop;

  return jsonb_build_object('added', v_added, 'skipped', v_skipped);
end;
$$;
