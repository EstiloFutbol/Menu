-- Deshacer un consumo del menú (receta o producto completado).
-- Al completar se descuenta de la despensa lo que haya: si había menos de lo
-- que se gasta, se queda a 0. Para poder devolver exactamente lo que se quitó,
-- cada ingrediente consumido guarda ahora lo realmente descontado y en qué
-- unidad (la de la despensa en ese momento).

alter table public.consumption_ingredients
  add column if not exists pantry_deducted_quantity numeric(12,3) check (pantry_deducted_quantity is null or pantry_deducted_quantity >= 0),
  add column if not exists pantry_deducted_unit public.measurement_unit;

-- Descuenta de la despensa y devuelve cuánto se ha quitado de verdad (en la unidad de la despensa).
create or replace function public.deduct_from_pantry(p_user_id uuid, p_ingredient_id uuid, p_quantity numeric, p_unit public.measurement_unit, out deducted numeric, out deducted_unit public.measurement_unit)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pantry public.pantry_items%rowtype;
  v_converted numeric;
begin
  deducted := 0;
  deducted_unit := null;
  select * into v_pantry from public.pantry_items
  where user_id = p_user_id and ingredient_id = p_ingredient_id
  for update;
  if not found or v_pantry.quantity is null or v_pantry.unit is null then return; end if;

  v_converted := public.convert_compatible_quantity(p_quantity, p_unit, v_pantry.unit);
  if v_converted is null or v_converted <= 0 then return; end if;

  deducted := least(v_pantry.quantity, v_converted);
  deducted_unit := v_pantry.unit;
  if deducted > 0 then
    update public.pantry_items set quantity = quantity - deducted where id = v_pantry.id;
  end if;
end;
$$;

-- Marca la franja como completada solo si todo lo planificado está consumido.
create or replace function public.refresh_menu_entry_completion(p_menu_entry_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.menu_entries
  set completed_at = case
    when (select count(*) from public.consumption_logs where menu_entry_id = p_menu_entry_id) >=
         (select count(*) from public.menu_entry_recipes where menu_entry_id = p_menu_entry_id) +
         (select count(*) from public.menu_entry_products where menu_entry_id = p_menu_entry_id)
      then coalesce(completed_at, now())
    else null
  end
  where id = p_menu_entry_id and user_id = auth.uid();
$$;

create or replace function public.complete_planned_recipe(
  p_menu_entry_recipe_id uuid,
  p_servings numeric,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_planned public.menu_entry_recipes%rowtype;
  v_log_id uuid;
  v_item jsonb;
  v_ingredient_id uuid;
  v_quantity numeric;
  v_unit public.measurement_unit;
  v_deduction record;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_servings is null or p_servings <= 0 then raise exception 'Servings must be greater than zero'; end if;

  select mer.* into v_planned
  from public.menu_entry_recipes mer
  join public.menu_entries me on me.id = mer.menu_entry_id
  where mer.id = p_menu_entry_recipe_id
    and me.user_id = v_user_id;

  if not found then raise exception 'Planned recipe not found'; end if;

  insert into public.consumption_logs (user_id, menu_entry_id, recipe_id, menu_entry_recipe_id, servings)
  values (v_user_id, v_planned.menu_entry_id, v_planned.recipe_id, v_planned.id, p_servings)
  returning id into v_log_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_ingredient_id := (v_item ->> 'ingredient_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_unit := (v_item ->> 'unit')::public.measurement_unit;
    if v_quantity < 0 then raise exception 'Ingredient quantity cannot be negative'; end if;

    select * into v_deduction from public.deduct_from_pantry(v_user_id, v_ingredient_id, v_quantity, v_unit);

    insert into public.consumption_ingredients (
      consumption_log_id, ingredient_id, quantity, unit, deducted_from_pantry, pantry_deducted_quantity, pantry_deducted_unit
    ) values (
      v_log_id, v_ingredient_id, v_quantity, v_unit, v_deduction.deducted > 0,
      case when v_deduction.deducted > 0 then v_deduction.deducted end,
      case when v_deduction.deducted > 0 then v_deduction.deducted_unit end
    );
  end loop;

  perform public.refresh_menu_entry_completion(v_planned.menu_entry_id);
  return v_log_id;
exception
  when unique_violation then raise exception 'This planned recipe has already been completed';
end;
$$;

create or replace function public.complete_planned_product(
  p_menu_entry_product_id uuid,
  p_quantity numeric,
  p_unit public.measurement_unit
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_product public.menu_entry_products%rowtype;
  v_log_id uuid;
  v_deduction record;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;

  select mep.* into v_product
  from public.menu_entry_products mep
  join public.menu_entries me on me.id = mep.menu_entry_id
  where mep.id = p_menu_entry_product_id and me.user_id = v_user_id;

  if not found then raise exception 'Planned product not found'; end if;

  insert into public.consumption_logs (user_id, menu_entry_id, menu_entry_product_id)
  values (v_user_id, v_product.menu_entry_id, v_product.id)
  returning id into v_log_id;

  select * into v_deduction from public.deduct_from_pantry(v_user_id, v_product.ingredient_id, p_quantity, p_unit);

  insert into public.consumption_ingredients (
    consumption_log_id, ingredient_id, quantity, unit, deducted_from_pantry, pantry_deducted_quantity, pantry_deducted_unit
  ) values (
    v_log_id, v_product.ingredient_id, p_quantity, p_unit, v_deduction.deducted > 0,
    case when v_deduction.deducted > 0 then v_deduction.deducted end,
    case when v_deduction.deducted > 0 then v_deduction.deducted_unit end
  );

  perform public.refresh_menu_entry_completion(v_product.menu_entry_id);
  return v_log_id;
exception
  when unique_violation then raise exception 'This planned product has already been completed';
end;
$$;

-- Deshace un consumo: devuelve a la despensa lo que se descontó (nada si no se
-- descontó nada), borra el registro y la receta o el producto vuelve a estar
-- pendiente en el menú. Devuelve qué se ha devuelto y qué no se ha podido devolver.
create or replace function public.undo_consumption(p_consumption_log_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_log public.consumption_logs%rowtype;
  v_item record;
  v_amount numeric;
  v_unit public.measurement_unit;
  v_pantry public.pantry_items%rowtype;
  v_converted numeric;
  v_returned jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select * into v_log from public.consumption_logs
  where id = p_consumption_log_id and user_id = v_user_id
  for update;
  if not found then raise exception 'Consumption not found'; end if;

  for v_item in
    select ci.*, i.name as ingredient_name
    from public.consumption_ingredients ci
    join public.ingredients i on i.id = ci.ingredient_id
    where ci.consumption_log_id = v_log.id and ci.deducted_from_pantry
  loop
    -- Consumos anteriores a esta migración no guardan lo descontado: se usa lo consumido.
    v_amount := coalesce(v_item.pantry_deducted_quantity, v_item.quantity);
    v_unit := coalesce(v_item.pantry_deducted_unit, v_item.unit);
    if v_amount is null or v_amount <= 0 then continue; end if;

    select * into v_pantry from public.pantry_items
    where user_id = v_user_id and ingredient_id = v_item.ingredient_id
    for update;

    if not found then
      insert into public.pantry_items (user_id, ingredient_id, quantity, unit)
      values (v_user_id, v_item.ingredient_id, v_amount, v_unit);
      v_returned := v_returned || jsonb_build_object('name', v_item.ingredient_name, 'quantity', v_amount, 'unit', v_unit);
    elsif v_pantry.quantity is null then
      -- Ahora se controla por estado: si se devuelve algo, «Tengo».
      update public.pantry_items set status = 'tengo' where id = v_pantry.id;
      v_returned := v_returned || jsonb_build_object('name', v_item.ingredient_name, 'quantity', v_amount, 'unit', v_unit);
    else
      v_converted := public.convert_compatible_quantity(v_amount, v_unit, v_pantry.unit);
      if v_converted is null then
        v_skipped := v_skipped || jsonb_build_object('name', v_item.ingredient_name, 'quantity', v_amount, 'unit', v_unit, 'pantry_unit', v_pantry.unit);
      else
        update public.pantry_items set quantity = quantity + v_converted where id = v_pantry.id;
        v_returned := v_returned || jsonb_build_object('name', v_item.ingredient_name, 'quantity', v_amount, 'unit', v_unit);
      end if;
    end if;
  end loop;

  delete from public.consumption_logs where id = v_log.id;
  if v_log.menu_entry_id is not null then
    perform public.refresh_menu_entry_completion(v_log.menu_entry_id);
  end if;

  return jsonb_build_object('returned', v_returned, 'skipped', v_skipped);
end;
$$;

revoke execute on function public.deduct_from_pantry(uuid, uuid, numeric, public.measurement_unit) from public, anon;
revoke execute on function public.refresh_menu_entry_completion(uuid) from public, anon;
revoke execute on function public.undo_consumption(uuid) from public, anon;
grant execute on function public.deduct_from_pantry(uuid, uuid, numeric, public.measurement_unit) to authenticated;
grant execute on function public.refresh_menu_entry_completion(uuid) to authenticated;
grant execute on function public.undo_consumption(uuid) to authenticated;
