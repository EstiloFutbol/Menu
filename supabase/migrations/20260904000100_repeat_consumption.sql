-- Permite añadir y consumir varias veces la misma receta o producto en una misma franja.
-- Cada consumo de receta queda vinculado a la fila concreta planificada, igual que ya ocurre con productos.

alter table public.menu_entry_recipes
  drop constraint if exists menu_entry_recipes_menu_entry_id_recipe_id_key;

alter table public.menu_entry_products
  drop constraint if exists menu_entry_products_menu_entry_id_ingredient_id_key;

alter table public.consumption_logs
  add column if not exists menu_entry_recipe_id uuid references public.menu_entry_recipes(id) on delete set null;

-- Migra los consumos existentes antes de retirar la unicidad antigua.
update public.consumption_logs cl
set menu_entry_recipe_id = mer.id
from public.menu_entry_recipes mer
where cl.menu_entry_recipe_id is null
  and cl.menu_entry_id = mer.menu_entry_id
  and cl.recipe_id = mer.recipe_id;

drop index if exists public.consumption_logs_menu_recipe_unique;

create unique index if not exists consumption_logs_menu_recipe_row_unique
on public.consumption_logs (menu_entry_recipe_id)
where menu_entry_recipe_id is not null;

create index if not exists menu_entry_recipes_entry_idx
on public.menu_entry_recipes (menu_entry_id);

drop function if exists public.complete_planned_recipe(uuid, uuid, numeric, jsonb);

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
  v_entry public.menu_entries%rowtype;
  v_log_id uuid;
  v_item jsonb;
  v_ingredient_id uuid;
  v_quantity numeric;
  v_unit public.measurement_unit;
  v_pantry public.pantry_items%rowtype;
  v_converted numeric;
  v_deducted boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_servings is null or p_servings <= 0 then raise exception 'Servings must be greater than zero'; end if;

  select mer.* into v_planned
  from public.menu_entry_recipes mer
  join public.menu_entries me on me.id = mer.menu_entry_id
  where mer.id = p_menu_entry_recipe_id
    and me.user_id = v_user_id;

  if not found then raise exception 'Planned recipe not found'; end if;

  select * into v_entry
  from public.menu_entries
  where id = v_planned.menu_entry_id and user_id = v_user_id;

  insert into public.consumption_logs (
    user_id,
    menu_entry_id,
    recipe_id,
    menu_entry_recipe_id,
    servings
  ) values (
    v_user_id,
    v_planned.menu_entry_id,
    v_planned.recipe_id,
    v_planned.id,
    p_servings
  )
  returning id into v_log_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_ingredient_id := (v_item ->> 'ingredient_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_unit := (v_item ->> 'unit')::public.measurement_unit;
    v_deducted := false;

    if v_quantity < 0 then raise exception 'Ingredient quantity cannot be negative'; end if;

    select * into v_pantry
    from public.pantry_items
    where user_id = v_user_id and ingredient_id = v_ingredient_id
    for update;

    if found and v_pantry.quantity is not null and v_pantry.unit is not null then
      v_converted := null;
      if v_pantry.unit = v_unit then v_converted := v_quantity;
      elsif v_unit = 'g' and v_pantry.unit = 'kg' then v_converted := v_quantity / 1000;
      elsif v_unit = 'kg' and v_pantry.unit = 'g' then v_converted := v_quantity * 1000;
      elsif v_unit = 'ml' and v_pantry.unit = 'l' then v_converted := v_quantity / 1000;
      elsif v_unit = 'l' and v_pantry.unit = 'ml' then v_converted := v_quantity * 1000;
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

  if (
    select count(*) from public.consumption_logs where menu_entry_id = v_planned.menu_entry_id
  ) >= (
    (select count(*) from public.menu_entry_recipes where menu_entry_id = v_planned.menu_entry_id) +
    (select count(*) from public.menu_entry_products where menu_entry_id = v_planned.menu_entry_id)
  ) then
    update public.menu_entries
    set completed_at = now()
    where id = v_planned.menu_entry_id and user_id = v_user_id;
  end if;

  return v_log_id;
exception
  when unique_violation then raise exception 'This planned recipe has already been completed';
end;
$$;
