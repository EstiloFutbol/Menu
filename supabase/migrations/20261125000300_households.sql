-- Modo hogar, fase 1: los datos pasan a ser del HOGAR en vez de cada usuario.
-- Por fuera no cambia nada: cada usuario tiene su hogar personal con sus datos.
--
-- * households: hogares. `personal_for` marca el hogar personal de un usuario
--   (no se puede borrar ni salir de él).
-- * household_members: quién está en cada hogar y con qué rol.
-- * user_settings.active_household_id: el hogar que el usuario está viendo.
-- * current_household_id(): el hogar activo (si sigue siendo miembro) o el personal.
-- * Las 8 tablas con dueño reciben household_id (relleno con el hogar personal
--   del dueño). user_id se queda como «quién lo hizo» y ya no borra nada si se
--   borra la cuenta (on delete set null): nunca se pierde información del hogar.
-- * Seguridad (RLS) y funciones pasan de «mis filas» a «las filas de mi hogar».

-- Hogares --------------------------------------------------------------------

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  personal_for uuid unique references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index if not exists household_members_user_idx on public.household_members (user_id);

alter table public.user_settings
  add column if not exists active_household_id uuid references public.households(id) on delete set null;

-- Hogares de los que es miembro el usuario (sin pasar por RLS, para usarlo en las políticas).
create or replace function public.my_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id from public.household_members where user_id = auth.uid()
$$;

-- Hogar que se está usando: el activo si sigue siendo miembro; si no, el personal.
create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.active_household_id
       from public.user_settings s
       join public.household_members m on m.household_id = s.active_household_id and m.user_id = s.user_id
      where s.user_id = auth.uid()),
    (select h.id from public.households h where h.personal_for = auth.uid())
  )
$$;

-- Crea (si no existe) el hogar personal de un usuario y lo hace responsable de él.
create or replace function public.ensure_personal_household(p_user_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
begin
  select id into v_household_id from public.households where personal_for = p_user_id;
  if v_household_id is null then
    insert into public.households (name, personal_for, created_by)
    values (left('Hogar de ' || coalesce(nullif(split_part(coalesce(p_email, ''), '@', 1), ''), 'casa'), 80), p_user_id, p_user_id)
    returning id into v_household_id;
  end if;
  insert into public.household_members (household_id, user_id, role)
  values (v_household_id, p_user_id, 'owner')
  on conflict (household_id, user_id) do nothing;
  return v_household_id;
end;
$$;

-- Hogar personal para todas las cuentas que ya existen.
do $$
declare
  v_user record;
begin
  for v_user in select id, email from auth.users loop
    perform public.ensure_personal_household(v_user.id, v_user.email);
  end loop;
end $$;

-- household_id en las tablas con dueño ---------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array['ingredients', 'recipes', 'menu_entries', 'pantry_items', 'shopping_lists', 'purchases', 'consumption_logs', 'receipt_aliases'] loop
    execute format('alter table public.%I add column if not exists household_id uuid references public.households(id) on delete restrict', v_table);
    execute format('update public.%I t set household_id = h.id from public.households h where h.personal_for = t.user_id and t.household_id is null', v_table);
    execute format('alter table public.%I alter column household_id set not null', v_table);
    execute format('alter table public.%I alter column household_id set default public.current_household_id()', v_table);
    -- user_id = quién lo hizo. Borrar una cuenta ya no borra datos del hogar.
    execute format('alter table public.%I alter column user_id drop not null', v_table);
    execute format('alter table public.%I alter column user_id set default auth.uid()', v_table);
    execute format('alter table public.%I drop constraint if exists %I', v_table, v_table || '_user_id_fkey');
    execute format('alter table public.%I add constraint %I foreign key (user_id) references auth.users(id) on delete set null', v_table, v_table || '_user_id_fkey');
  end loop;
end $$;

-- Lo que antes era único por usuario pasa a ser único por hogar.
alter table public.ingredients drop constraint if exists ingredients_user_id_name_key;
alter table public.ingredients add constraint ingredients_household_name_key unique (household_id, name);
alter table public.menu_entries drop constraint if exists menu_entries_user_id_planned_date_meal_key;
alter table public.menu_entries add constraint menu_entries_household_date_meal_key unique (household_id, planned_date, meal);
alter table public.pantry_items drop constraint if exists pantry_items_user_id_ingredient_id_key;
alter table public.pantry_items add constraint pantry_items_household_ingredient_key unique (household_id, ingredient_id);
alter table public.shopping_lists drop constraint if exists shopping_lists_user_id_week_start_key;
alter table public.shopping_lists add constraint shopping_lists_household_week_key unique (household_id, week_start);
alter table public.receipt_aliases drop constraint if exists receipt_aliases_user_id_normalized_name_key;
alter table public.receipt_aliases add constraint receipt_aliases_household_name_key unique (household_id, normalized_name);

drop index if exists public.ingredients_user_name_idx;
drop index if exists public.recipes_user_name_idx;
drop index if exists public.menu_entries_user_date_idx;
drop index if exists public.pantry_items_user_idx;
drop index if exists public.shopping_lists_user_week_idx;
drop index if exists public.purchases_user_date_idx;
drop index if exists public.consumption_logs_user_date_idx;
create index if not exists ingredients_household_name_idx on public.ingredients (household_id, lower(name));
create index if not exists recipes_household_name_idx on public.recipes (household_id, lower(name));
create index if not exists purchases_household_date_idx on public.purchases (household_id, purchased_at desc);
create index if not exists consumption_logs_household_date_idx on public.consumption_logs (household_id, consumed_at desc);
create index if not exists receipt_aliases_ingredient_idx on public.receipt_aliases (ingredient_id);

-- Seguridad (RLS) ------------------------------------------------------------

alter table public.households enable row level security;
alter table public.household_members enable row level security;

drop policy if exists "member households" on public.households;
create policy "member households" on public.households
  for select to authenticated using (id in (select public.my_household_ids()));
drop policy if exists "member household members" on public.household_members;
create policy "member household members" on public.household_members
  for select to authenticated using (household_id in (select public.my_household_ids()));

-- Tablas con dueño: las filas del hogar que se está usando.
drop policy if exists "own ingredients" on public.ingredients;
create policy "own ingredients" on public.ingredients
  for all using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

drop policy if exists "own recipes" on public.recipes;
create policy "own recipes" on public.recipes
  for all using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

drop policy if exists "own menu entries" on public.menu_entries;
create policy "own menu entries" on public.menu_entries
  for all using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

drop policy if exists "own shopping lists" on public.shopping_lists;
create policy "own shopping lists" on public.shopping_lists
  for all using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

drop policy if exists "own purchases" on public.purchases;
create policy "own purchases" on public.purchases
  for all using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

-- Y lo que enlazan tiene que ser del mismo hogar (como antes, del mismo usuario).
drop policy if exists "own pantry" on public.pantry_items;
create policy "own pantry" on public.pantry_items
  for all using (household_id = (select public.current_household_id()))
  with check (
    household_id = (select public.current_household_id())
    and exists (select 1 from public.ingredients i where i.id = ingredient_id and i.household_id = (select public.current_household_id()))
  );

drop policy if exists "own receipt aliases" on public.receipt_aliases;
create policy "own receipt aliases" on public.receipt_aliases
  for all using (household_id = (select public.current_household_id()))
  with check (
    household_id = (select public.current_household_id())
    and exists (select 1 from public.ingredients i where i.id = ingredient_id and i.household_id = (select public.current_household_id()))
  );

drop policy if exists "own consumption logs" on public.consumption_logs;
create policy "own consumption logs" on public.consumption_logs
  for all using (household_id = (select public.current_household_id()))
  with check (
    household_id = (select public.current_household_id())
    and (menu_entry_id is null or exists (select 1 from public.menu_entries m where m.id = menu_entry_id and m.household_id = (select public.current_household_id())))
    and (recipe_id is null or exists (select 1 from public.recipes r where r.id = recipe_id and r.household_id = (select public.current_household_id())))
    and (menu_entry_recipe_id is null or exists (
      select 1 from public.menu_entry_recipes mer join public.menu_entries m on m.id = mer.menu_entry_id
      where mer.id = menu_entry_recipe_id and m.household_id = (select public.current_household_id())))
    and (menu_entry_product_id is null or exists (
      select 1 from public.menu_entry_products mep join public.menu_entries m on m.id = mep.menu_entry_id
      where mep.id = menu_entry_product_id and m.household_id = (select public.current_household_id())))
  );

-- Tablas hijas: se comprueba el hogar de la fila padre.
drop policy if exists "own recipe ingredients" on public.recipe_ingredients;
create policy "own recipe ingredients" on public.recipe_ingredients
  for all using (exists (select 1 from public.recipes r where r.id = recipe_id and r.household_id = (select public.current_household_id())))
  with check (
    exists (select 1 from public.recipes r where r.id = recipe_id and r.household_id = (select public.current_household_id()))
    and exists (select 1 from public.ingredients i where i.id = ingredient_id and i.household_id = (select public.current_household_id()))
  );

drop policy if exists "own recipe steps" on public.recipe_steps;
create policy "own recipe steps" on public.recipe_steps
  for all using (exists (select 1 from public.recipes r where r.id = recipe_id and r.household_id = (select public.current_household_id())))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and r.household_id = (select public.current_household_id())));

drop policy if exists "own menu recipes" on public.menu_entry_recipes;
create policy "own menu recipes" on public.menu_entry_recipes
  for all using (exists (select 1 from public.menu_entries m where m.id = menu_entry_id and m.household_id = (select public.current_household_id())))
  with check (
    exists (select 1 from public.menu_entries m where m.id = menu_entry_id and m.household_id = (select public.current_household_id()))
    and exists (select 1 from public.recipes r where r.id = recipe_id and r.household_id = (select public.current_household_id()))
  );

drop policy if exists "own menu products" on public.menu_entry_products;
create policy "own menu products" on public.menu_entry_products
  for all using (exists (select 1 from public.menu_entries m where m.id = menu_entry_id and m.household_id = (select public.current_household_id())))
  with check (
    exists (select 1 from public.menu_entries m where m.id = menu_entry_id and m.household_id = (select public.current_household_id()))
    and exists (select 1 from public.ingredients i where i.id = ingredient_id and i.household_id = (select public.current_household_id()))
  );

drop policy if exists "own shopping items" on public.shopping_items;
create policy "own shopping items" on public.shopping_items
  for all using (exists (select 1 from public.shopping_lists s where s.id = shopping_list_id and s.household_id = (select public.current_household_id())))
  with check (
    exists (select 1 from public.shopping_lists s where s.id = shopping_list_id and s.household_id = (select public.current_household_id()))
    and (ingredient_id is null or exists (select 1 from public.ingredients i where i.id = ingredient_id and i.household_id = (select public.current_household_id())))
  );

drop policy if exists "own purchase items" on public.purchase_items;
create policy "own purchase items" on public.purchase_items
  for all using (exists (select 1 from public.purchases p where p.id = purchase_id and p.household_id = (select public.current_household_id())))
  with check (
    exists (select 1 from public.purchases p where p.id = purchase_id and p.household_id = (select public.current_household_id()))
    and (ingredient_id is null or exists (select 1 from public.ingredients i where i.id = ingredient_id and i.household_id = (select public.current_household_id())))
  );

drop policy if exists "own consumption ingredients" on public.consumption_ingredients;
create policy "own consumption ingredients" on public.consumption_ingredients
  for all using (exists (select 1 from public.consumption_logs c where c.id = consumption_log_id and c.household_id = (select public.current_household_id())))
  with check (
    exists (select 1 from public.consumption_logs c where c.id = consumption_log_id and c.household_id = (select public.current_household_id()))
    and exists (select 1 from public.ingredients i where i.id = ingredient_id and i.household_id = (select public.current_household_id()))
  );

-- Funciones ------------------------------------------------------------------

-- Descontar de la despensa ahora recibe el hogar.
drop function if exists public.deduct_from_pantry(uuid, uuid, numeric, public.measurement_unit);
create or replace function public.deduct_from_pantry(p_household_id uuid, p_ingredient_id uuid, p_quantity numeric, p_unit public.measurement_unit, out deducted numeric, out deducted_unit public.measurement_unit)
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
  where household_id = p_household_id and ingredient_id = p_ingredient_id
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
  where id = p_menu_entry_id and household_id = public.current_household_id();
$$;

-- Productos básicos: se añaden a un hogar.
create or replace function public.seed_basic_ingredients_for_household(p_household_id uuid, p_created_by uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_added integer;
begin
  insert into public.ingredients (household_id, user_id, name, category, default_unit)
  select p_household_id, p_created_by, b.name, b.category, b.default_unit
  from public.basic_ingredient_catalog() b
  where not exists (
    select 1 from public.ingredients i
    where i.household_id = p_household_id
      and (public.normalize_receipt_name(i.name) = public.normalize_receipt_name(b.name)
        or public.normalize_receipt_name(i.name) like public.normalize_receipt_name(b.name) || ' %')
  )
  on conflict (household_id, name) do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

-- Se mantiene por compatibilidad: siembra el hogar personal del usuario.
create or replace function public.seed_basic_ingredients(p_user_id uuid)
returns integer
language sql
security invoker
set search_path = public
as $$
  select public.seed_basic_ingredients_for_household((select id from public.households where personal_for = p_user_id), p_user_id)
$$;

-- Botón de la app: añade al hogar actual los básicos que falten.
create or replace function public.add_basic_ingredients()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  return public.seed_basic_ingredients_for_household(public.current_household_id(), auth.uid());
end;
$$;

-- Cuenta nueva: hogar personal y productos básicos.
create or replace function public.seed_basic_ingredients_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
begin
  v_household_id := public.ensure_personal_household(new.id, new.email);
  perform public.seed_basic_ingredients_for_household(v_household_id, new.id);
  return new;
end;
$$;

-- add_to_menu_slots: mismas reglas que antes, filtrando por el hogar actual.
create or replace function public.add_to_menu_slots(p_slots jsonb, p_recipes jsonb, p_products jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid := public.current_household_id();
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
      or not exists (select 1 from public.recipes r where r.id = item.recipe_id and r.household_id = v_household_id)
  ) then
    raise exception 'Invalid recipe';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_products, '[]'::jsonb)) as item(ingredient_id uuid, quantity numeric, unit public.measurement_unit)
    where item.quantity is null or item.quantity <= 0 or item.unit is null
      or not exists (select 1 from public.ingredients i where i.id = item.ingredient_id and i.household_id = v_household_id)
  ) then
    raise exception 'Invalid product';
  end if;

  for v_slot in
    select distinct slot.planned_date, slot.meal
    from jsonb_to_recordset(p_slots) as slot(planned_date date, meal public.meal_type)
  loop
    insert into public.menu_entries (user_id, planned_date, meal)
    values (v_user_id, v_slot.planned_date, v_slot.meal)
    on conflict (household_id, planned_date, meal) do nothing;

    select id, is_eating_out into v_entry_id, v_eating_out
    from public.menu_entries
    where household_id = v_household_id and planned_date = v_slot.planned_date and meal = v_slot.meal;

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

-- complete_planned_product: mismas reglas que antes, filtrando por el hogar actual.
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
  v_household_id uuid := public.current_household_id();
  v_product public.menu_entry_products%rowtype;
  v_log_id uuid;
  v_deduction record;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;

  select mep.* into v_product
  from public.menu_entry_products mep
  join public.menu_entries me on me.id = mep.menu_entry_id
  where mep.id = p_menu_entry_product_id and me.household_id = v_household_id;

  if not found then raise exception 'Planned product not found'; end if;

  insert into public.consumption_logs (user_id, menu_entry_id, menu_entry_product_id)
  values (v_user_id, v_product.menu_entry_id, v_product.id)
  returning id into v_log_id;

  select * into v_deduction from public.deduct_from_pantry(v_household_id, v_product.ingredient_id, p_quantity, p_unit);

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

-- complete_planned_recipe: mismas reglas que antes, filtrando por el hogar actual.
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
  v_household_id uuid := public.current_household_id();
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
    and me.household_id = v_household_id;

  if not found then raise exception 'Planned recipe not found'; end if;

  insert into public.consumption_logs (user_id, menu_entry_id, recipe_id, menu_entry_recipe_id, servings)
  values (v_user_id, v_planned.menu_entry_id, v_planned.recipe_id, v_planned.id, p_servings)
  returning id into v_log_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_ingredient_id := (v_item ->> 'ingredient_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_unit := (v_item ->> 'unit')::public.measurement_unit;
    if v_quantity < 0 then raise exception 'Ingredient quantity cannot be negative'; end if;

    select * into v_deduction from public.deduct_from_pantry(v_household_id, v_ingredient_id, v_quantity, v_unit);

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

-- copy_menu_week: mismas reglas que antes, filtrando por el hogar actual.
create or replace function public.copy_menu_week(p_from_week date, p_to_week date, p_replace boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid := public.current_household_id();
  v_offset integer := p_to_week - p_from_week;
  v_source record;
  v_target public.menu_entries%rowtype;
  v_target_date date;
  v_recipe_order integer;
  v_product_order integer;
  v_has_rows boolean;
  v_slots integer := 0;
  v_recipes integer := 0;
  v_products integer := 0;
  v_count integer;
  v_skipped jsonb := '[]'::jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_from_week is null or p_to_week is null or v_offset = 0 then raise exception 'Choose a different week'; end if;

  if p_replace then
    -- Lo pendiente (sin consumo) de la semana de destino se quita.
    delete from public.menu_entry_recipes mer
    using public.menu_entries me
    where mer.menu_entry_id = me.id and me.household_id = v_household_id
      and me.planned_date between p_to_week and p_to_week + 6
      and not exists (select 1 from public.consumption_logs cl where cl.menu_entry_recipe_id = mer.id);
    delete from public.menu_entry_products mep
    using public.menu_entries me
    where mep.menu_entry_id = me.id and me.household_id = v_household_id
      and me.planned_date between p_to_week and p_to_week + 6
      and not exists (select 1 from public.consumption_logs cl where cl.menu_entry_product_id = mep.id);
    -- Franjas que se quedan vacías y sin consumos (incluidas las de «Comida fuera»).
    delete from public.menu_entries me
    where me.household_id = v_household_id and me.planned_date between p_to_week and p_to_week + 6
      and not exists (select 1 from public.menu_entry_recipes where menu_entry_id = me.id)
      and not exists (select 1 from public.menu_entry_products where menu_entry_id = me.id)
      and not exists (select 1 from public.consumption_logs where menu_entry_id = me.id);
  end if;

  for v_source in
    select * from public.menu_entries
    where household_id = v_household_id and planned_date between p_from_week and p_from_week + 6
    order by planned_date, meal
  loop
    v_target_date := v_source.planned_date + v_offset;

    -- Franja de origen sin nada que copiar.
    if not v_source.is_eating_out
       and not exists (select 1 from public.menu_entry_recipes where menu_entry_id = v_source.id)
       and not exists (select 1 from public.menu_entry_products where menu_entry_id = v_source.id) then
      continue;
    end if;

    insert into public.menu_entries (user_id, planned_date, meal)
    values (v_user_id, v_target_date, v_source.meal)
    on conflict (household_id, planned_date, meal) do nothing;
    select * into v_target from public.menu_entries
    where household_id = v_household_id and planned_date = v_target_date and meal = v_source.meal
    for update;

    v_has_rows := exists (select 1 from public.menu_entry_recipes where menu_entry_id = v_target.id)
      or exists (select 1 from public.menu_entry_products where menu_entry_id = v_target.id);

    if v_source.is_eating_out then
      if v_target.is_eating_out then
        null;
      elsif v_has_rows or exists (select 1 from public.consumption_logs where menu_entry_id = v_target.id) then
        v_skipped := v_skipped || jsonb_build_object('planned_date', v_target_date, 'meal', v_source.meal, 'reason', 'planned');
        continue;
      else
        update public.menu_entries set is_eating_out = true, completed_at = null where id = v_target.id;
      end if;
      v_slots := v_slots + 1;
      continue;
    end if;

    if v_target.is_eating_out then
      v_skipped := v_skipped || jsonb_build_object('planned_date', v_target_date, 'meal', v_source.meal, 'reason', 'eating_out');
      continue;
    end if;

    select coalesce(max(sort_order) + 1, 0) into v_recipe_order from public.menu_entry_recipes where menu_entry_id = v_target.id;
    select coalesce(max(sort_order) + 1, 0) into v_product_order from public.menu_entry_products where menu_entry_id = v_target.id;

    insert into public.menu_entry_recipes (menu_entry_id, recipe_id, servings, sort_order)
    select v_target.id, recipe_id, servings, v_recipe_order + row_number() over (order by sort_order) - 1
    from public.menu_entry_recipes where menu_entry_id = v_source.id;
    get diagnostics v_count = row_count;
    v_recipes := v_recipes + v_count;

    insert into public.menu_entry_products (menu_entry_id, ingredient_id, quantity, unit, sort_order)
    select v_target.id, ingredient_id, quantity, unit, v_product_order + row_number() over (order by sort_order) - 1
    from public.menu_entry_products where menu_entry_id = v_source.id;
    get diagnostics v_count = row_count;
    v_products := v_products + v_count;

    -- Tiene filas nuevas sin consumir: deja de estar completada.
    update public.menu_entries set completed_at = null where id = v_target.id and completed_at is not null;
    v_slots := v_slots + 1;
  end loop;

  return jsonb_build_object('slots', v_slots, 'recipes', v_recipes, 'products', v_products, 'skipped', v_skipped);
end;
$$;

-- delete_purchase_and_reverse_pantry: mismas reglas que antes, filtrando por el hogar actual.
create or replace function public.delete_purchase_and_reverse_pantry(p_purchase_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid := public.current_household_id();
  v_item record;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  if not exists (
    select 1 from public.purchases
    where id = p_purchase_id and household_id = v_household_id
  ) then
    raise exception 'Purchase not found';
  end if;

  for v_item in
    select id from public.purchase_items
    where purchase_id = p_purchase_id
    order by created_at desc
  loop
    perform public.reverse_purchase_item_pantry_effect(v_item.id);
  end loop;

  delete from public.purchases
  where id = p_purchase_id and household_id = v_household_id;
end;
$$;

-- delete_purchase_item_and_reverse_pantry: mismas reglas que antes, filtrando por el hogar actual.
create or replace function public.delete_purchase_item_and_reverse_pantry(p_purchase_item_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid := public.current_household_id();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  if not exists (
    select 1
    from public.purchase_items pi
    join public.purchases p on p.id = pi.purchase_id
    where pi.id = p_purchase_item_id and p.household_id = v_household_id
  ) then
    raise exception 'Purchase item not found';
  end if;

  perform public.reverse_purchase_item_pantry_effect(p_purchase_item_id);
  delete from public.purchase_items where id = p_purchase_item_id;
end;
$$;

-- delete_unused_ingredient: mismas reglas que antes, filtrando por el hogar actual.
create or replace function public.delete_unused_ingredient(p_ingredient_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid := public.current_household_id();
  v_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select name into v_name
  from public.ingredients
  where id = p_ingredient_id and household_id = v_household_id;

  if not found then
    raise exception 'Ingredient not found';
  end if;

  if exists (select 1 from public.recipe_ingredients where ingredient_id = p_ingredient_id)
     or exists (select 1 from public.menu_entry_products where ingredient_id = p_ingredient_id)
     or exists (select 1 from public.shopping_items where ingredient_id = p_ingredient_id)
     or exists (select 1 from public.purchase_items where ingredient_id = p_ingredient_id)
     or exists (select 1 from public.consumption_ingredients where ingredient_id = p_ingredient_id)
  then
    raise exception 'Este producto ya tiene uso en recetas, menú, compras o consumos. No se puede eliminar sin perder histórico.';
  end if;

  delete from public.pantry_items
  where household_id = v_household_id and ingredient_id = p_ingredient_id;

  delete from public.receipt_aliases
  where household_id = v_household_id and ingredient_id = p_ingredient_id;

  delete from public.ingredients
  where id = p_ingredient_id and household_id = v_household_id;
end;
$$;

-- import_reviewed_receipt: mismas reglas que antes, filtrando por el hogar actual.
create or replace function public.import_reviewed_receipt(
  p_store_name text,
  p_purchased_at timestamptz,
  p_total_amount numeric,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid := public.current_household_id();
  v_purchase_id uuid;
  v_item jsonb;
  v_ingredient_id uuid;
  v_canonical_name text;
  v_raw_name text;
  v_normalized_name text;
  v_category text;
  v_quantity numeric;
  v_unit public.measurement_unit;
  v_total_price numeric;
  v_add_to_pantry boolean;
  v_pantry public.pantry_items%rowtype;
  v_converted numeric;
  v_effect_applied boolean;
  v_added_quantity numeric;
  v_added_unit public.measurement_unit;
  v_status_before public.pantry_status;
  v_status_changed boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_store_name), '') is null then raise exception 'Store name is required'; end if;
  if p_total_amount is null or p_total_amount < 0 then raise exception 'Invalid total amount'; end if;

  insert into public.purchases (user_id, purchased_at, store_name, total_amount, currency, notes)
  values (v_user_id, coalesce(p_purchased_at, now()), trim(p_store_name), p_total_amount, 'EUR', 'Importado desde foto de ticket')
  returning id into v_purchase_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_raw_name := trim(v_item ->> 'raw_name');
    v_canonical_name := trim(v_item ->> 'canonical_name');
    v_normalized_name := trim(v_item ->> 'normalized_name');
    v_category := coalesce(nullif(trim(v_item ->> 'category'), ''), 'Otros');
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_unit := (v_item ->> 'unit')::public.measurement_unit;
    v_total_price := coalesce((v_item ->> 'total_price')::numeric, 0);
    v_add_to_pantry := coalesce((v_item ->> 'add_to_pantry')::boolean, true);
    v_ingredient_id := nullif(v_item ->> 'ingredient_id', '')::uuid;

    v_effect_applied := false;
    v_added_quantity := null;
    v_added_unit := null;
    v_status_before := null;
    v_status_changed := false;

    if v_raw_name = '' or v_canonical_name = '' then raise exception 'Product names are required'; end if;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Product quantity must be greater than zero'; end if;
    if v_total_price < 0 then raise exception 'Product price cannot be negative'; end if;

    if v_ingredient_id is not null then
      if not exists (select 1 from public.ingredients where id = v_ingredient_id and household_id = v_household_id) then
        raise exception 'Ingredient does not belong to current user';
      end if;
    else
      select id into v_ingredient_id
      from public.ingredients
      where household_id = v_household_id and lower(trim(name)) = lower(v_canonical_name)
      limit 1;

      if v_ingredient_id is null then
        insert into public.ingredients (user_id, name, category, default_unit)
        values (v_user_id, v_canonical_name, v_category, v_unit)
        returning id into v_ingredient_id;
      end if;
    end if;

    if v_add_to_pantry then
      select * into v_pantry
      from public.pantry_items
      where household_id = v_household_id and ingredient_id = v_ingredient_id
      for update;

      if not found then
        insert into public.pantry_items (user_id, ingredient_id, quantity, unit, status)
        values (v_user_id, v_ingredient_id, v_quantity, v_unit, null);
        v_effect_applied := true;
        v_added_quantity := v_quantity;
        v_added_unit := v_unit;
      elsif v_pantry.quantity is null then
        v_status_before := v_pantry.status;
        update public.pantry_items
        set status = 'tengo'
        where id = v_pantry.id;
        v_effect_applied := true;
        v_status_changed := v_pantry.status is distinct from 'tengo';
      else
        v_converted := null;
        if v_pantry.unit = v_unit then v_converted := v_quantity;
        elsif v_unit = 'g' and v_pantry.unit = 'kg' then v_converted := v_quantity / 1000;
        elsif v_unit = 'kg' and v_pantry.unit = 'g' then v_converted := v_quantity * 1000;
        elsif v_unit = 'ml' and v_pantry.unit = 'l' then v_converted := v_quantity / 1000;
        elsif v_unit = 'l' and v_pantry.unit = 'ml' then v_converted := v_quantity * 1000;
        end if;

        if v_converted is null then
          raise exception 'Incompatible pantry unit for %', v_canonical_name;
        end if;

        update public.pantry_items
        set quantity = quantity + v_converted,
            status = null
        where id = v_pantry.id;

        v_effect_applied := true;
        v_added_quantity := v_converted;
        v_added_unit := v_pantry.unit;
      end if;
    end if;

    insert into public.purchase_items (
      purchase_id, ingredient_id, raw_name, quantity, unit,
      price_before_discount, discount_amount, total_price,
      pantry_effect_applied, pantry_added_quantity, pantry_added_unit,
      pantry_status_before, pantry_status_changed
    ) values (
      v_purchase_id, v_ingredient_id, v_raw_name, v_quantity, v_unit,
      v_total_price, 0, v_total_price,
      v_effect_applied, v_added_quantity, v_added_unit,
      v_status_before, v_status_changed
    );

    insert into public.receipt_aliases (user_id, raw_name, normalized_name, ingredient_id)
    values (v_user_id, v_raw_name, v_normalized_name, v_ingredient_id)
    on conflict (household_id, normalized_name)
    do update set raw_name = excluded.raw_name, ingredient_id = excluded.ingredient_id, updated_at = now();
  end loop;

  return v_purchase_id;
end;
$$;

-- merge_ingredients: mismas reglas que antes, filtrando por el hogar actual.
create or replace function public.merge_ingredients(p_source_id uuid, p_target_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid := public.current_household_id();
  v_source public.ingredients%rowtype;
  v_target public.ingredients%rowtype;
  v_row record;
  v_existing record;
  v_converted numeric;
  v_source_pantry public.pantry_items%rowtype;
  v_target_pantry public.pantry_items%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_source_id = p_target_id then raise exception 'Cannot merge a product with itself'; end if;

  select * into v_source from public.ingredients where id = p_source_id and household_id = v_household_id for update;
  if not found then raise exception 'Ingredient not found'; end if;
  select * into v_target from public.ingredients where id = p_target_id and household_id = v_household_id for update;
  if not found then raise exception 'Ingredient not found'; end if;

  -- Recetas: si la receta ya tiene el destino con la misma unidad, se suman las cantidades.
  for v_row in select * from public.recipe_ingredients where ingredient_id = p_source_id loop
    select * into v_existing from public.recipe_ingredients
    where recipe_id = v_row.recipe_id and ingredient_id = p_target_id and unit = v_row.unit;
    if found then
      update public.recipe_ingredients
      set quantity = quantity + v_row.quantity,
          notes = nullif(concat_ws('; ', nullif(notes, ''), nullif(v_row.notes, '')), '')
      where id = v_existing.id;
      delete from public.recipe_ingredients where id = v_row.id;
    else
      update public.recipe_ingredients set ingredient_id = p_target_id where id = v_row.id;
    end if;
  end loop;

  -- Menú: una franja solo puede tener el producto una vez.
  for v_row in select * from public.menu_entry_products where ingredient_id = p_source_id loop
    select * into v_existing from public.menu_entry_products
    where menu_entry_id = v_row.menu_entry_id and ingredient_id = p_target_id;
    if found then
      v_converted := public.convert_compatible_quantity(v_row.quantity, v_row.unit, v_existing.unit);
      if v_converted is null then raise exception 'Merge conflict in menu'; end if;
      update public.menu_entry_products set quantity = quantity + v_converted where id = v_existing.id;
      update public.consumption_logs set menu_entry_product_id = v_existing.id where menu_entry_product_id = v_row.id;
      delete from public.menu_entry_products where id = v_row.id;
    else
      update public.menu_entry_products set ingredient_id = p_target_id where id = v_row.id;
    end if;
  end loop;

  -- Sin restricciones de unicidad: basta con cambiar el producto.
  update public.shopping_items set ingredient_id = p_target_id where ingredient_id = p_source_id;
  update public.purchase_items set ingredient_id = p_target_id where ingredient_id = p_source_id;
  update public.consumption_ingredients set ingredient_id = p_target_id where ingredient_id = p_source_id;
  update public.receipt_aliases set ingredient_id = p_target_id where ingredient_id = p_source_id and household_id = v_household_id;

  -- Los próximos tickets que traigan el nombre del origen se traducirán al destino.
  insert into public.receipt_aliases (user_id, raw_name, normalized_name, ingredient_id)
  values (v_user_id, v_source.name, public.normalize_receipt_name(v_source.name), p_target_id)
  on conflict (household_id, normalized_name) do update set ingredient_id = excluded.ingredient_id;

  -- Despensa: se suma lo que hubiera de los dos.
  select * into v_source_pantry from public.pantry_items where household_id = v_household_id and ingredient_id = p_source_id for update;
  if found then
    select * into v_target_pantry from public.pantry_items where household_id = v_household_id and ingredient_id = p_target_id for update;
    if not found then
      update public.pantry_items set ingredient_id = p_target_id where id = v_source_pantry.id;
    else
      if v_target_pantry.quantity is not null and v_source_pantry.quantity is not null then
        v_converted := public.convert_compatible_quantity(v_source_pantry.quantity, v_source_pantry.unit, v_target_pantry.unit);
        if v_converted is null then
          raise exception 'Merge conflict in pantry: % % and % %', v_source_pantry.quantity, v_source_pantry.unit, v_target_pantry.quantity, v_target_pantry.unit;
        end if;
        update public.pantry_items set quantity = quantity + v_converted where id = v_target_pantry.id;
      elsif v_target_pantry.quantity is null
        and (coalesce(v_source_pantry.quantity, 0) > 0 or v_source_pantry.status in ('tengo', 'queda_poco'))
        and v_target_pantry.status is distinct from 'tengo' then
        -- El destino se controla por estado: si del origen había algo, ahora «Tengo».
        update public.pantry_items
        set status = case when v_source_pantry.status = 'queda_poco' and v_target_pantry.status = 'queda_poco' then 'queda_poco'::public.pantry_status else 'tengo'::public.pantry_status end
        where id = v_target_pantry.id;
      end if;
      delete from public.pantry_items where id = v_source_pantry.id;
    end if;
  end if;

  delete from public.ingredients where id = p_source_id and household_id = v_household_id;
  return p_target_id;
end;
$$;

-- regenerate_shopping_list: mismas reglas que antes, filtrando por el hogar actual.
create or replace function public.regenerate_shopping_list(p_week_start date, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid := public.current_household_id();
  v_list_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item(value)
    where not exists (
      select 1 from public.ingredients i
      where i.id = (item.value->>'ingredient_id')::uuid and i.household_id = v_household_id
    )
  ) then
    raise exception 'Invalid product';
  end if;

  insert into public.shopping_lists (user_id, week_start)
  values (v_user_id, p_week_start)
  on conflict (household_id, week_start) do nothing;

  select id into v_list_id
  from public.shopping_lists
  where household_id = v_household_id and week_start = p_week_start;

  delete from public.shopping_items
  where shopping_list_id = v_list_id and source = 'menu' and not checked;

  insert into public.shopping_items (shopping_list_id, ingredient_id, quantity, unit, pantry_check_required, sort_order, source)
  select
    v_list_id,
    (item.value->>'ingredient_id')::uuid,
    (item.value->>'quantity')::numeric,
    (item.value->>'unit')::public.measurement_unit,
    coalesce((item.value->>'pantry_check_required')::boolean, false),
    item.position::integer - 1,
    'menu'
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as item(value, position);

  return v_list_id;
end;
$$;

-- reverse_purchase_item_pantry_effect: mismas reglas que antes, filtrando por el hogar actual.
create or replace function public.reverse_purchase_item_pantry_effect(p_purchase_item_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid := public.current_household_id();
  v_item public.purchase_items%rowtype;
  v_pantry public.pantry_items%rowtype;
  v_converted numeric;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select pi.* into v_item
  from public.purchase_items pi
  join public.purchases p on p.id = pi.purchase_id
  where pi.id = p_purchase_item_id and p.household_id = v_household_id
  for update of pi;

  if not found then raise exception 'Purchase item not found'; end if;
  if not v_item.pantry_effect_applied or v_item.ingredient_id is null then return; end if;

  select * into v_pantry
  from public.pantry_items
  where household_id = v_household_id and ingredient_id = v_item.ingredient_id
  for update;

  if not found then return; end if;

  if v_item.pantry_added_quantity is not null and v_item.pantry_added_unit is not null and v_pantry.quantity is not null and v_pantry.unit is not null then
    v_converted := null;
    if v_pantry.unit = v_item.pantry_added_unit then v_converted := v_item.pantry_added_quantity;
    elsif v_item.pantry_added_unit = 'g' and v_pantry.unit = 'kg' then v_converted := v_item.pantry_added_quantity / 1000;
    elsif v_item.pantry_added_unit = 'kg' and v_pantry.unit = 'g' then v_converted := v_item.pantry_added_quantity * 1000;
    elsif v_item.pantry_added_unit = 'ml' and v_pantry.unit = 'l' then v_converted := v_item.pantry_added_quantity / 1000;
    elsif v_item.pantry_added_unit = 'l' and v_pantry.unit = 'ml' then v_converted := v_item.pantry_added_quantity * 1000;
    end if;

    if v_converted is not null then
      update public.pantry_items
      set quantity = greatest(0, quantity - v_converted)
      where id = v_pantry.id;
    end if;
  elsif v_item.pantry_status_changed and v_pantry.quantity is null and v_pantry.status = 'tengo' then
    update public.pantry_items
    set status = coalesce(v_item.pantry_status_before, 'no_tengo')
    where id = v_pantry.id;
  end if;
end;
$$;

-- save_menu_slot: mismas reglas que antes, filtrando por el hogar actual.
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
  v_household_id uuid := public.current_household_id();
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
      or not exists (select 1 from public.recipes r where r.id = (item.value->>'recipe_id')::uuid and r.household_id = v_household_id)
  ) then
    raise exception 'Invalid recipe';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) as item(value)
    where coalesce((item.value->>'quantity')::numeric, 0) <= 0
      or not exists (select 1 from public.ingredients i where i.id = (item.value->>'ingredient_id')::uuid and i.household_id = v_household_id)
  ) then
    raise exception 'Invalid product';
  end if;

  v_new_rows := case when p_eating_out then 0
    else jsonb_array_length(coalesce(p_recipes, '[]'::jsonb)) + jsonb_array_length(coalesce(p_products, '[]'::jsonb)) end;

  select id, completed_at into v_entry_id, v_completed_at
  from public.menu_entries
  where household_id = v_household_id and planned_date = p_planned_date and meal = p_meal
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

-- save_recipe: mismas reglas que antes, filtrando por el hogar actual.
create or replace function public.save_recipe(p_recipe_id uuid, p_recipe jsonb, p_ingredients jsonb, p_steps jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid := public.current_household_id();
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
    where id = v_recipe_id and household_id = v_household_id;

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
      if not exists (select 1 from public.ingredients where id = v_ingredient_id and household_id = v_household_id) then
        raise exception 'Invalid product';
      end if;
    else
      if nullif(trim(v_item.value->>'name'), '') is null then
        raise exception 'Product names are required';
      end if;

      select id into v_ingredient_id
      from public.ingredients
      where household_id = v_household_id and lower(name) = lower(trim(v_item.value->>'name'))
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

-- undo_consumption: mismas reglas que antes, filtrando por el hogar actual.
create or replace function public.undo_consumption(p_consumption_log_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid := public.current_household_id();
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
  where id = p_consumption_log_id and household_id = v_household_id
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
    where household_id = v_household_id and ingredient_id = v_item.ingredient_id
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

revoke execute on function public.my_household_ids() from public, anon;
revoke execute on function public.current_household_id() from public, anon;
revoke execute on function public.ensure_personal_household(uuid, text) from public, anon, authenticated;
revoke execute on function public.deduct_from_pantry(uuid, uuid, numeric, public.measurement_unit) from public, anon;
revoke execute on function public.seed_basic_ingredients_for_household(uuid, uuid) from public, anon;
grant execute on function public.my_household_ids() to authenticated;
grant execute on function public.current_household_id() to authenticated;
grant execute on function public.deduct_from_pantry(uuid, uuid, numeric, public.measurement_unit) to authenticated;
grant execute on function public.seed_basic_ingredients_for_household(uuid, uuid) to authenticated;
grant select on public.households, public.household_members to authenticated;
