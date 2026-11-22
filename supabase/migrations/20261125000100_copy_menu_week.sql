-- Copiar la planificación de una semana a otra, en una sola transacción.
-- Cada franja se copia al mismo día de la semana y la misma comida de destino.
-- Las recetas y productos se copian como pendientes (aunque en origen estén consumidos).
-- p_replace = false: se añade a lo que ya haya en la semana de destino.
-- p_replace = true: antes se quita lo pendiente de la semana de destino (lo ya
--   consumido se conserva siempre).
-- «Comida fuera» se copia solo si la franja de destino está vacía; las franjas de
-- destino marcadas como «Comida fuera» no reciben nada. Ambos casos se devuelven en `skipped`.
create or replace function public.copy_menu_week(p_from_week date, p_to_week date, p_replace boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
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
    where mer.menu_entry_id = me.id and me.user_id = v_user_id
      and me.planned_date between p_to_week and p_to_week + 6
      and not exists (select 1 from public.consumption_logs cl where cl.menu_entry_recipe_id = mer.id);
    delete from public.menu_entry_products mep
    using public.menu_entries me
    where mep.menu_entry_id = me.id and me.user_id = v_user_id
      and me.planned_date between p_to_week and p_to_week + 6
      and not exists (select 1 from public.consumption_logs cl where cl.menu_entry_product_id = mep.id);
    -- Franjas que se quedan vacías y sin consumos (incluidas las de «Comida fuera»).
    delete from public.menu_entries me
    where me.user_id = v_user_id and me.planned_date between p_to_week and p_to_week + 6
      and not exists (select 1 from public.menu_entry_recipes where menu_entry_id = me.id)
      and not exists (select 1 from public.menu_entry_products where menu_entry_id = me.id)
      and not exists (select 1 from public.consumption_logs where menu_entry_id = me.id);
  end if;

  for v_source in
    select * from public.menu_entries
    where user_id = v_user_id and planned_date between p_from_week and p_from_week + 6
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
    on conflict (user_id, planned_date, meal) do nothing;
    select * into v_target from public.menu_entries
    where user_id = v_user_id and planned_date = v_target_date and meal = v_source.meal
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

revoke execute on function public.copy_menu_week(date, date, boolean) from public, anon;
grant execute on function public.copy_menu_week(date, date, boolean) to authenticated;
