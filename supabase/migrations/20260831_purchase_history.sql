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

alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;

create policy "own purchases" on public.purchases
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own purchase items" on public.purchase_items
for all
using (exists (select 1 from public.purchases p where p.id = purchase_id and p.user_id = auth.uid()))
with check (exists (select 1 from public.purchases p where p.id = purchase_id and p.user_id = auth.uid()));

create index purchases_user_date_idx on public.purchases (user_id, purchased_at desc);
create index purchase_items_purchase_idx on public.purchase_items (purchase_id, receipt_line_number);
create index purchase_items_ingredient_idx on public.purchase_items (ingredient_id);
