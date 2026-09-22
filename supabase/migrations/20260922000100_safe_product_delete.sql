create or replace function public.delete_unused_ingredient(p_ingredient_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select name into v_name
  from public.ingredients
  where id = p_ingredient_id and user_id = v_user_id;

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
  where user_id = v_user_id and ingredient_id = p_ingredient_id;

  delete from public.receipt_aliases
  where user_id = v_user_id and ingredient_id = p_ingredient_id;

  delete from public.ingredients
  where id = p_ingredient_id and user_id = v_user_id;
end;
$$;
