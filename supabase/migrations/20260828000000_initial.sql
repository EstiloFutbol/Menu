create extension if not exists pgcrypto;

create type public.measurement_unit as enum (
  'g', 'kg', 'ml', 'l', 'unidad', 'cucharada', 'cucharadita', 'taza', 'lata', 'paquete'
);

create type public.meal_type as enum (
  'desayuno', 'almuerzo', 'comida', 'merienda', 'cena'
);

create type public.pantry_status as enum (
  'tengo', 'queda_poco', 'no_tengo'
);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text,
  default_unit public.measurement_unit,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  preparation_minutes integer check (preparation_minutes is null or preparation_minutes >= 0),
  base_servings numeric(8,2) not null default 1 check (base_servings > 0),
  calories_per_serving numeric(10,2) check (calories_per_serving is null or calories_per_serving >= 0),
  protein_g_per_serving numeric(10,2) check (protein_g_per_serving is null or protein_g_per_serving >= 0),
  carbs_g_per_serving numeric(10,2) check (carbs_g_per_serving is null or carbs_g_per_serving >= 0),
  fiber_g_per_serving numeric(10,2) check (fiber_g_per_serving is null or fiber_g_per_serving >= 0),
  fat_g_per_serving numeric(10,2) check (fat_g_per_serving is null or fat_g_per_serving >= 0),
  sugar_g_per_serving numeric(10,2) check (sugar_g_per_serving is null or sugar_g_per_serving >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity numeric(12,3) not null check (quantity > 0),
  unit public.measurement_unit not null,
  notes text,
  sort_order integer not null default 0,
  unique (recipe_id, ingredient_id, unit)
);

create table public.recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  step_number integer not null check (step_number > 0),
  instruction text not null,
  unique (recipe_id, step_number)
);

create table public.menu_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  planned_date date not null,
  meal public.meal_type not null,
  is_eating_out boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, planned_date, meal)
);

create table public.menu_entry_recipes (
  id uuid primary key default gen_random_uuid(),
  menu_entry_id uuid not null references public.menu_entries(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete restrict,
  servings numeric(8,2) not null check (servings > 0),
  sort_order integer not null default 0,
  unique (menu_entry_id, recipe_id)
);

create table public.menu_entry_products (
  id uuid primary key default gen_random_uuid(),
  menu_entry_id uuid not null references public.menu_entries(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity numeric(12,3) not null check (quantity > 0),
  unit public.measurement_unit not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (menu_entry_id, ingredient_id)
);

create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  quantity numeric(12,3) check (quantity is null or quantity >= 0),
  unit public.measurement_unit,
  status public.pantry_status,
  notes text,
  updated_at timestamptz not null default now(),
  constraint pantry_quantity_unit_pair check (
    (quantity is null and unit is null) or (quantity is not null and unit is not null)
  ),
  constraint pantry_has_tracking_method check (
    quantity is not null or status is not null
  ),
  unique (user_id, ingredient_id)
);

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  shopping_list_id uuid not null references public.shopping_lists(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete set null,
  manual_name text,
  quantity numeric(12,3) check (quantity is null or quantity > 0),
  unit public.measurement_unit,
  pantry_check_required boolean not null default false,
  checked boolean not null default false,
  added_to_pantry boolean not null default false,
  sort_order integer not null default 0,
  constraint shopping_item_name check (
    ingredient_id is not null or nullif(trim(manual_name), '') is not null
  ),
  constraint shopping_quantity_unit_pair check (
    (quantity is null and unit is null) or (quantity is not null and unit is not null)
  )
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purchased_at timestamptz not null,
  store_name text not null,
  store_address text,
  total_amount numeric(10,2) not null check (total_amount >= 0),
  discount_total numeric(10,2) not null default 0 check (discount_total >= 0),
  currency text not null default 'EUR',
  receipt_number text,
  payment_method text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete set null,
  raw_name text not null,
  brand text,
  quantity numeric(12,3) check (quantity is null or quantity > 0),
  unit public.measurement_unit,
  packages numeric(8,2) check (packages is null or packages > 0),
  package_unit_price numeric(10,2) check (package_unit_price is null or package_unit_price >= 0),
  price_before_discount numeric(10,2) not null check (price_before_discount >= 0),
  discount_amount numeric(10,2) not null default 0 check (discount_amount >= 0),
  total_price numeric(10,2) not null check (total_price >= 0),
  reference_unit_price numeric(10,3) check (reference_unit_price is null or reference_unit_price >= 0),
  reference_unit public.measurement_unit,
  receipt_line_number integer,
  notes text,
  created_at timestamptz not null default now(),
  constraint purchase_item_quantity_unit_pair check (
    (quantity is null and unit is null) or (quantity is not null and unit is not null)
  ),
  constraint purchase_item_reference_pair check (
    (reference_unit_price is null and reference_unit is null) or (reference_unit_price is not null and reference_unit is not null)
  )
);

create table public.consumption_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  menu_entry_id uuid references public.menu_entries(id) on delete set null,
  recipe_id uuid references public.recipes(id) on delete set null,
  menu_entry_product_id uuid references public.menu_entry_products(id) on delete set null,
  servings numeric(8,2) check (servings is null or servings > 0),
  consumed_at timestamptz not null default now()
);

create table public.consumption_ingredients (
  id uuid primary key default gen_random_uuid(),
  consumption_log_id uuid not null references public.consumption_logs(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity numeric(12,3) not null check (quantity >= 0),
  unit public.measurement_unit not null,
  deducted_from_pantry boolean not null default false
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger ingredients_set_updated_at
before update on public.ingredients
for each row execute function public.set_updated_at();

create trigger recipes_set_updated_at
before update on public.recipes
for each row execute function public.set_updated_at();

create trigger menu_entries_set_updated_at
before update on public.menu_entries
for each row execute function public.set_updated_at();

create trigger pantry_items_set_updated_at
before update on public.pantry_items
for each row execute function public.set_updated_at();

alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_steps enable row level security;
alter table public.menu_entries enable row level security;
alter table public.menu_entry_recipes enable row level security;
alter table public.menu_entry_products enable row level security;
alter table public.pantry_items enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.consumption_logs enable row level security;
alter table public.consumption_ingredients enable row level security;

create policy "own ingredients" on public.ingredients
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own recipes" on public.recipes
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own recipe ingredients" on public.recipe_ingredients
for all
using (exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid()))
with check (exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid()));

create policy "own recipe steps" on public.recipe_steps
for all
using (exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid()))
with check (exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid()));

create policy "own menu entries" on public.menu_entries
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own menu recipes" on public.menu_entry_recipes
for all
using (exists (select 1 from public.menu_entries m where m.id = menu_entry_id and m.user_id = auth.uid()))
with check (exists (select 1 from public.menu_entries m where m.id = menu_entry_id and m.user_id = auth.uid()));

create policy "own menu products" on public.menu_entry_products
for all
using (exists (select 1 from public.menu_entries m where m.id = menu_entry_id and m.user_id = auth.uid()))
with check (exists (select 1 from public.menu_entries m where m.id = menu_entry_id and m.user_id = auth.uid()));

create policy "own pantry" on public.pantry_items
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own shopping lists" on public.shopping_lists
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own shopping items" on public.shopping_items
for all
using (exists (select 1 from public.shopping_lists s where s.id = shopping_list_id and s.user_id = auth.uid()))
with check (exists (select 1 from public.shopping_lists s where s.id = shopping_list_id and s.user_id = auth.uid()));

create policy "own purchases" on public.purchases
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own purchase items" on public.purchase_items
for all
using (exists (select 1 from public.purchases p where p.id = purchase_id and p.user_id = auth.uid()))
with check (exists (select 1 from public.purchases p where p.id = purchase_id and p.user_id = auth.uid()));

create policy "own consumption logs" on public.consumption_logs
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own consumption ingredients" on public.consumption_ingredients
for all
using (exists (select 1 from public.consumption_logs c where c.id = consumption_log_id and c.user_id = auth.uid()))
with check (exists (select 1 from public.consumption_logs c where c.id = consumption_log_id and c.user_id = auth.uid()));

create unique index consumption_logs_menu_recipe_unique
on public.consumption_logs (menu_entry_id, recipe_id)
where menu_entry_id is not null and recipe_id is not null;

create unique index consumption_logs_menu_product_unique
on public.consumption_logs (menu_entry_product_id)
where menu_entry_product_id is not null;

create index ingredients_user_name_idx on public.ingredients (user_id, lower(name));
create index recipes_user_name_idx on public.recipes (user_id, lower(name));
create index menu_entries_user_date_idx on public.menu_entries (user_id, planned_date);
create index menu_entry_products_entry_idx on public.menu_entry_products (menu_entry_id);
create index menu_entry_products_ingredient_idx on public.menu_entry_products (ingredient_id);
create index pantry_items_user_idx on public.pantry_items (user_id);
create index shopping_lists_user_week_idx on public.shopping_lists (user_id, week_start);
create index purchases_user_date_idx on public.purchases (user_id, purchased_at desc);
create index purchase_items_purchase_idx on public.purchase_items (purchase_id, receipt_line_number);
create index purchase_items_ingredient_idx on public.purchase_items (ingredient_id);
create index consumption_logs_user_date_idx on public.consumption_logs (user_id, consumed_at desc);

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
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_servings is null or p_servings <= 0 then raise exception 'Servings must be greater than zero'; end if;

  if not exists (
    select 1 from public.menu_entries me
    join public.menu_entry_recipes mer on mer.menu_entry_id = me.id
    where me.id = p_menu_entry_id and me.user_id = v_user_id and mer.recipe_id = p_recipe_id
  ) then
    raise exception 'Planned recipe not found';
  end if;

  insert into public.consumption_logs (user_id, menu_entry_id, recipe_id, servings)
  values (v_user_id, p_menu_entry_id, p_recipe_id, p_servings)
  returning id into v_log_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_ingredient_id := (v_item ->> 'ingredient_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_unit := (v_item ->> 'unit')::public.measurement_unit;
    v_deducted := false;

    if v_quantity < 0 then raise exception 'Ingredient quantity cannot be negative'; end if;

    select * into v_pantry from public.pantry_items
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
        update public.pantry_items set quantity = greatest(0, quantity - v_converted) where id = v_pantry.id;
        v_deducted := true;
      end if;
    end if;

    insert into public.consumption_ingredients (consumption_log_id, ingredient_id, quantity, unit, deducted_from_pantry)
    values (v_log_id, v_ingredient_id, v_quantity, v_unit, v_deducted);
  end loop;

  if (
    select count(*) from public.consumption_logs where menu_entry_id = p_menu_entry_id
  ) >= (
    (select count(*) from public.menu_entry_recipes where menu_entry_id = p_menu_entry_id) +
    (select count(*) from public.menu_entry_products where menu_entry_id = p_menu_entry_id)
  ) then
    update public.menu_entries set completed_at = now() where id = p_menu_entry_id and user_id = v_user_id;
  end if;

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
  v_entry public.menu_entries%rowtype;
  v_pantry public.pantry_items%rowtype;
  v_log_id uuid;
  v_converted numeric;
  v_deducted boolean := false;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;

  select mep.* into v_product
  from public.menu_entry_products mep
  join public.menu_entries me on me.id = mep.menu_entry_id
  where mep.id = p_menu_entry_product_id and me.user_id = v_user_id;

  if not found then raise exception 'Planned product not found'; end if;

  select * into v_entry from public.menu_entries where id = v_product.menu_entry_id and user_id = v_user_id;

  insert into public.consumption_logs (user_id, menu_entry_id, menu_entry_product_id)
  values (v_user_id, v_product.menu_entry_id, v_product.id)
  returning id into v_log_id;

  select * into v_pantry from public.pantry_items
  where user_id = v_user_id and ingredient_id = v_product.ingredient_id
  for update;

  if found and v_pantry.quantity is not null and v_pantry.unit is not null then
    v_converted := null;
    if v_pantry.unit = p_unit then v_converted := p_quantity;
    elsif p_unit = 'g' and v_pantry.unit = 'kg' then v_converted := p_quantity / 1000;
    elsif p_unit = 'kg' and v_pantry.unit = 'g' then v_converted := p_quantity * 1000;
    elsif p_unit = 'ml' and v_pantry.unit = 'l' then v_converted := p_quantity / 1000;
    elsif p_unit = 'l' and v_pantry.unit = 'ml' then v_converted := p_quantity * 1000;
    end if;

    if v_converted is not null and v_converted > 0 then
      update public.pantry_items set quantity = greatest(0, quantity - v_converted) where id = v_pantry.id;
      v_deducted := true;
    end if;
  end if;

  insert into public.consumption_ingredients (consumption_log_id, ingredient_id, quantity, unit, deducted_from_pantry)
  values (v_log_id, v_product.ingredient_id, p_quantity, p_unit, v_deducted);

  if (
    select count(*) from public.consumption_logs where menu_entry_id = v_product.menu_entry_id
  ) >= (
    (select count(*) from public.menu_entry_recipes where menu_entry_id = v_product.menu_entry_id) +
    (select count(*) from public.menu_entry_products where menu_entry_id = v_product.menu_entry_id)
  ) then
    update public.menu_entries set completed_at = now() where id = v_product.menu_entry_id and user_id = v_user_id;
  end if;

  return v_log_id;
exception
  when unique_violation then raise exception 'This planned product has already been completed';
end;
$$;
