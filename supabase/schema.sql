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

create table public.consumption_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  menu_entry_id uuid references public.menu_entries(id) on delete set null,
  recipe_id uuid references public.recipes(id) on delete set null,
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
alter table public.pantry_items enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;
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

create policy "own pantry" on public.pantry_items
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own shopping lists" on public.shopping_lists
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own shopping items" on public.shopping_items
for all
using (exists (select 1 from public.shopping_lists s where s.id = shopping_list_id and s.user_id = auth.uid()))
with check (exists (select 1 from public.shopping_lists s where s.id = shopping_list_id and s.user_id = auth.uid()));

create policy "own consumption logs" on public.consumption_logs
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own consumption ingredients" on public.consumption_ingredients
for all
using (exists (select 1 from public.consumption_logs c where c.id = consumption_log_id and c.user_id = auth.uid()))
with check (exists (select 1 from public.consumption_logs c where c.id = consumption_log_id and c.user_id = auth.uid()));

create index ingredients_user_name_idx on public.ingredients (user_id, lower(name));
create index recipes_user_name_idx on public.recipes (user_id, lower(name));
create index menu_entries_user_date_idx on public.menu_entries (user_id, planned_date);
create index pantry_items_user_idx on public.pantry_items (user_id);
create index shopping_lists_user_week_idx on public.shopping_lists (user_id, week_start);
create index consumption_logs_user_date_idx on public.consumption_logs (user_id, consumed_at desc);
