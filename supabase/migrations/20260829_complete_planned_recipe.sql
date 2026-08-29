create unique index if not exists consumption_logs_menu_recipe_unique
on public.consumption_logs (menu_entry_id, recipe_id)
where menu_entry_id is not null and recipe_id is not null;

create or replace function public.complete_planned_recipe(
  p_menu_entry_id uuid,
  p_recipe_id uuid,
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
  v_log_id uuid;
  v_item jsonb;
  v_ingredient_id uuid;
  v_quantity numeric;
  v_unit public.measurement_unit;
  v_pantry public.pantry_items%rowtype;
  v_converted numeric;
  v_deducted boolean;
  v_recipe_count integer;
  v_log_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_servings is null or p_servings <= 0 then
    raise exception 'Servings must be greater than zero';
  end if;

  if not exists (
    select 1
    from public.menu_entries me
    join public.menu_entry_recipes mer on mer.menu_entry_id = me.id
    where me.id = p_menu_entry_id
      and me.user_id = v_user_id
      and mer.recipe_id = p_recipe_id
  ) then
    raise exception 'Planned recipe not found';
  end if;

  insert into public.consumption_logs (user_id, menu_entry_id, recipe_id, servings)
  values (v_user_id, p_menu_entry_id, p_recipe_id, p_servings)
  returning id into v_log_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_ingredient_id := (v_item ->> 'ingredient_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_unit := (v_item ->> 'unit')::public.measurement_unit;
    v_deducted := false;

    if v_quantity < 0 then
      raise exception 'Ingredient quantity cannot be negative';
    end if;

    select * into v_pantry
    from public.pantry_items
    where user_id = v_user_id and ingredient_id = v_ingredient_id
    for update;

    if found and v_pantry.quantity is not null and v_pantry.unit is not null then
      v_converted := null;

      if v_pantry.unit = v_unit then
        v_converted := v_quantity;
      elsif v_unit = 'g' and v_pantry.unit = 'kg' then
        v_converted := v_quantity / 1000;
      elsif v_unit = 'kg' and v_pantry.unit = 'g' then
        v_converted := v_quantity * 1000;
      elsif v_unit = 'ml' and v_pantry.unit = 'l' then
        v_converted := v_quantity / 1000;
      elsif v_unit = 'l' and v_pantry.unit = 'ml' then
        v_converted := v_quantity * 1000;
      end if;

      if v_converted is not null and v_converted > 0 then
        update public.pantry_items
        set quantity = greatest(0, quantity - v_converted)
        where id = v_pantry.id;
        v_deducted := true;
      end if;
    end if;

    insert into public.consumption_ingredients (
      consumption_log_id, ingredient_id, quantity, unit, deducted_from_pantry
    ) values (
      v_log_id, v_ingredient_id, v_quantity, v_unit, v_deducted
    );
  end loop;

  select count(*) into v_recipe_count
  from public.menu_entry_recipes
  where menu_entry_id = p_menu_entry_id;

  select count(*) into v_log_count
  from public.consumption_logs
  where menu_entry_id = p_menu_entry_id;

  if v_recipe_count > 0 and v_log_count >= v_recipe_count then
    update public.menu_entries
    set completed_at = now()
    where id = p_menu_entry_id and user_id = v_user_id;
  end if;

  return v_log_id;
exception
  when unique_violation then
    raise exception 'This planned recipe has already been completed';
end;
$$;
