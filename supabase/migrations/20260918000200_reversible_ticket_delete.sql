alter table public.purchase_items
  add column if not exists pantry_effect_applied boolean not null default false,
  add column if not exists pantry_added_quantity numeric(12,3),
  add column if not exists pantry_added_unit public.measurement_unit,
  add column if not exists pantry_status_before public.pantry_status,
  add column if not exists pantry_status_changed boolean not null default false;

alter table public.purchase_items
  add constraint purchase_item_pantry_added_pair check (
    (pantry_added_quantity is null and pantry_added_unit is null)
    or (pantry_added_quantity is not null and pantry_added_unit is not null and pantry_added_quantity >= 0)
  );

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

    if v_add_to_pantry then
      select * into v_pantry
      from public.pantry_items
      where user_id = v_user_id and ingredient_id = v_ingredient_id
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
    on conflict (user_id, normalized_name)
    do update set raw_name = excluded.raw_name, ingredient_id = excluded.ingredient_id, updated_at = now();
  end loop;

  return v_purchase_id;
end;
$$;

create or replace function public.reverse_purchase_item_pantry_effect(p_purchase_item_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item public.purchase_items%rowtype;
  v_pantry public.pantry_items%rowtype;
  v_converted numeric;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select pi.* into v_item
  from public.purchase_items pi
  join public.purchases p on p.id = pi.purchase_id
  where pi.id = p_purchase_item_id and p.user_id = v_user_id
  for update of pi;

  if not found then raise exception 'Purchase item not found'; end if;
  if not v_item.pantry_effect_applied or v_item.ingredient_id is null then return; end if;

  select * into v_pantry
  from public.pantry_items
  where user_id = v_user_id and ingredient_id = v_item.ingredient_id
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

create or replace function public.delete_purchase_item_and_reverse_pantry(p_purchase_item_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  if not exists (
    select 1
    from public.purchase_items pi
    join public.purchases p on p.id = pi.purchase_id
    where pi.id = p_purchase_item_id and p.user_id = v_user_id
  ) then
    raise exception 'Purchase item not found';
  end if;

  perform public.reverse_purchase_item_pantry_effect(p_purchase_item_id);
  delete from public.purchase_items where id = p_purchase_item_id;
end;
$$;

create or replace function public.delete_purchase_and_reverse_pantry(p_purchase_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item record;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  if not exists (
    select 1 from public.purchases
    where id = p_purchase_id and user_id = v_user_id
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
  where id = p_purchase_id and user_id = v_user_id;
end;
$$;
