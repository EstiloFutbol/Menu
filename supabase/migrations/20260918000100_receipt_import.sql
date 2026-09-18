create table if not exists public.receipt_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  raw_name text not null,
  normalized_name text not null,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_name)
);

alter table public.receipt_aliases enable row level security;

create policy "own receipt aliases" on public.receipt_aliases
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists receipt_aliases_user_normalized_idx
on public.receipt_aliases (user_id, normalized_name);

create trigger receipt_aliases_set_updated_at
before update on public.receipt_aliases
for each row execute function public.set_updated_at();

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

    if v_raw_name = '' or v_canonical_name = '' then raise exception 'Product names are required'; end if;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Product quantity must be greater than zero'; end if;
    if v_total_price < 0 then raise exception 'Product price cannot be negative'; end if;

    if v_ingredient_id is not null then
      if not exists (select 1 from public.ingredients where id = v_ingredient_id and user_id = v_user_id) then
        raise exception 'Ingredient does not belong to current user';
      end if;
    else
      select id into v_ingredient_id
      from public.ingredients
      where user_id = v_user_id and lower(trim(name)) = lower(v_canonical_name)
      limit 1;

      if v_ingredient_id is null then
        insert into public.ingredients (user_id, name, category, default_unit)
        values (v_user_id, v_canonical_name, v_category, v_unit)
        returning id into v_ingredient_id;
      end if;
    end if;

    insert into public.purchase_items (
      purchase_id, ingredient_id, raw_name, quantity, unit,
      price_before_discount, discount_amount, total_price
    ) values (
      v_purchase_id, v_ingredient_id, v_raw_name, v_quantity, v_unit,
      v_total_price, 0, v_total_price
    );

    insert into public.receipt_aliases (user_id, raw_name, normalized_name, ingredient_id)
    values (v_user_id, v_raw_name, v_normalized_name, v_ingredient_id)
    on conflict (user_id, normalized_name)
    do update set raw_name = excluded.raw_name, ingredient_id = excluded.ingredient_id, updated_at = now();

    if v_add_to_pantry then
      select * into v_pantry
      from public.pantry_items
      where user_id = v_user_id and ingredient_id = v_ingredient_id
      for update;

      if not found then
        insert into public.pantry_items (user_id, ingredient_id, quantity, unit, status)
        values (v_user_id, v_ingredient_id, v_quantity, v_unit, null);
      elsif v_pantry.quantity is null then
        update public.pantry_items
        set status = 'tengo'
        where id = v_pantry.id;
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
      end if;
    end if;
  end loop;

  return v_purchase_id;
end;
$$;
