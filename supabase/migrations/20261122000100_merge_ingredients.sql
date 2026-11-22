-- Fusionar un producto del catálogo con otro (p. ej. «Lomo salmón noruego» → «Salmón»).
-- Todo lo que apuntaba al producto de origen pasa al de destino (recetas, menú,
-- lista de la compra, compras, consumos, despensa y traducciones de tickets) y
-- después se borra el de origen. Así se puede quitar un duplicado sin perder el
-- histórico, que es lo que impide delete_unused_ingredient.
-- Es una sola transacción: si algo no se puede fusionar, no cambia nada.

-- Mismo criterio que normalizeReceiptName (src/lib/receipt.ts).
create or replace function public.normalize_receipt_name(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(regexp_replace(
    translate(lower(coalesce(p_value, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
    '[^a-z0-9]+', ' ', 'g'))
$$;

-- Cantidad expresada en otra unidad compatible (g↔kg, ml↔l), o null si no se puede.
create or replace function public.convert_compatible_quantity(p_quantity numeric, p_from public.measurement_unit, p_to public.measurement_unit)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when p_quantity is null then null
    when p_from = p_to then p_quantity
    when p_from = 'g' and p_to = 'kg' then p_quantity / 1000
    when p_from = 'kg' and p_to = 'g' then p_quantity * 1000
    when p_from = 'ml' and p_to = 'l' then p_quantity / 1000
    when p_from = 'l' and p_to = 'ml' then p_quantity * 1000
    else null
  end
$$;

create or replace function public.merge_ingredients(p_source_id uuid, p_target_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
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

  select * into v_source from public.ingredients where id = p_source_id and user_id = v_user_id for update;
  if not found then raise exception 'Ingredient not found'; end if;
  select * into v_target from public.ingredients where id = p_target_id and user_id = v_user_id for update;
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
  update public.receipt_aliases set ingredient_id = p_target_id where ingredient_id = p_source_id and user_id = v_user_id;

  -- Los próximos tickets que traigan el nombre del origen se traducirán al destino.
  insert into public.receipt_aliases (user_id, raw_name, normalized_name, ingredient_id)
  values (v_user_id, v_source.name, public.normalize_receipt_name(v_source.name), p_target_id)
  on conflict (user_id, normalized_name) do update set ingredient_id = excluded.ingredient_id;

  -- Despensa: se suma lo que hubiera de los dos.
  select * into v_source_pantry from public.pantry_items where user_id = v_user_id and ingredient_id = p_source_id for update;
  if found then
    select * into v_target_pantry from public.pantry_items where user_id = v_user_id and ingredient_id = p_target_id for update;
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

  delete from public.ingredients where id = p_source_id and user_id = v_user_id;
  return p_target_id;
end;
$$;

revoke execute on function public.merge_ingredients(uuid, uuid) from public, anon;
revoke execute on function public.normalize_receipt_name(text) from public, anon;
revoke execute on function public.convert_compatible_quantity(numeric, public.measurement_unit, public.measurement_unit) from public, anon;
grant execute on function public.merge_ingredients(uuid, uuid) to authenticated;
grant execute on function public.normalize_receipt_name(text) to authenticated;
grant execute on function public.convert_compatible_quantity(numeric, public.measurement_unit, public.measurement_unit) to authenticated;
