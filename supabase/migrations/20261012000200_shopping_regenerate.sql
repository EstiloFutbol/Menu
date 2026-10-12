-- Distingue los ítems de la lista generados desde el menú de los añadidos a mano,
-- para que regenerar la lista solo sustituya los generados que aún no se han comprado.
alter table public.shopping_items
  add column if not exists source text not null default 'manual'
  check (source in ('menu', 'manual'));

-- Los ítems generados hasta ahora tenían sort_order < 1000 y los manuales >= 1000.
update public.shopping_items
set source = 'menu'
where sort_order < 1000 and manual_name is null;

-- Sustituye en una sola transacción los ítems generados pendientes por los nuevos.
-- Se conservan los manuales y los ya marcados como comprados.
create or replace function public.regenerate_shopping_list(p_week_start date, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_list_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item(value)
    where not exists (
      select 1 from public.ingredients i
      where i.id = (item.value->>'ingredient_id')::uuid and i.user_id = v_user_id
    )
  ) then
    raise exception 'Invalid product';
  end if;

  insert into public.shopping_lists (user_id, week_start)
  values (v_user_id, p_week_start)
  on conflict (user_id, week_start) do nothing;

  select id into v_list_id
  from public.shopping_lists
  where user_id = v_user_id and week_start = p_week_start;

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
