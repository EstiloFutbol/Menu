create table if not exists public.menu_entry_products (
  id uuid primary key default gen_random_uuid(),
  menu_entry_id uuid not null references public.menu_entries(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity numeric(12,3) not null check (quantity > 0),
  unit public.measurement_unit not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(menu_entry_id, ingredient_id)
);

alter table public.menu_entry_products enable row level security;

create policy "menu_entry_products_select_own" on public.menu_entry_products
  for select using (exists (select 1 from public.menu_entries me where me.id = menu_entry_id and me.user_id = auth.uid()));

create policy "menu_entry_products_insert_own" on public.menu_entry_products
  for insert with check (exists (select 1 from public.menu_entries me where me.id = menu_entry_id and me.user_id = auth.uid()));

create policy "menu_entry_products_update_own" on public.menu_entry_products
  for update using (exists (select 1 from public.menu_entries me where me.id = menu_entry_id and me.user_id = auth.uid()))
  with check (exists (select 1 from public.menu_entries me where me.id = menu_entry_id and me.user_id = auth.uid()));

create policy "menu_entry_products_delete_own" on public.menu_entry_products
  for delete using (exists (select 1 from public.menu_entries me where me.id = menu_entry_id and me.user_id = auth.uid()));

create index if not exists idx_menu_entry_products_entry on public.menu_entry_products(menu_entry_id);
create index if not exists idx_menu_entry_products_ingredient on public.menu_entry_products(ingredient_id);
