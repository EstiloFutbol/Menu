-- Modo hogar, fase 2: compartir el hogar con otras cuentas.
--
-- * Invitaciones a un hogar: `app_invites` con kind = 'household' y el hogar al
--   que invitan. Sirven para crear una cuenta (entra directamente en ese hogar)
--   o, si ya se tiene cuenta, para unirse desde Ajustes → Hogar.
-- * Funciones de gestión: unirse, cambiar de hogar, salir (con copia opcional al
--   hogar personal), quitar a alguien y cambiar el nombre.
-- * NINGUNA borra datos: solo cambian quién es miembro y qué hogar se ve. Lo que
--   alguien añadió se queda en el hogar para los demás.
-- * El hogar personal no se puede dejar: siempre hay a dónde volver.
-- * Las preferencias de planificación pasan a ser del hogar (household_settings),
--   copiadas de las de cada cuenta. Las de user_settings se conservan sin tocar.

-- Todo o nada: si algo fallara a mitad, no se aplica ningún cambio.
begin;

-- Invitaciones a un hogar ------------------------------------------------------

alter table public.app_invites
  add column if not exists household_id uuid references public.households(id) on delete cascade;
alter table public.app_invites drop constraint if exists app_invites_household_kind;
alter table public.app_invites add constraint app_invites_household_kind
  check ((kind = 'household') = (household_id is not null)) not valid; -- solo para las nuevas: las que ya hay no se tocan
create index if not exists app_invites_household_idx on public.app_invites (household_id);

-- Solo se puede invitar a un hogar del que se es responsable, también escribiendo
-- directamente en la tabla (sin pasar por create_app_invite).
drop policy if exists "own invites insert" on public.app_invites;
create policy "own invites insert" on public.app_invites
  for insert to authenticated with check (
    created_by = auth.uid()
    and (household_id is null or exists (select 1 from public.household_members m
                                         where m.household_id = app_invites.household_id and m.user_id = auth.uid() and m.role = 'owner')));
drop policy if exists "own invites update" on public.app_invites;
create policy "own invites update" on public.app_invites
  for update to authenticated using (created_by = auth.uid()) with check (
    created_by = auth.uid()
    and (household_id is null or exists (select 1 from public.household_members m
                                         where m.household_id = app_invites.household_id and m.user_id = auth.uid() and m.role = 'owner')));

-- Antes no tenía parámetros: se sustituye por la versión que elige el tipo.
drop function if exists public.create_app_invite();

-- p_kind: 'app' (cuenta nueva con su propio hogar) o 'household' (a tu hogar actual).
create or replace function public.create_app_invite(p_kind text default 'app')
returns public.app_invites
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid;
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  v_invite public.app_invites;
  v_bytes bytea;
  v_index integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_kind is null or p_kind not in ('app', 'household') then raise exception 'Invalid invite kind'; end if;
  if p_kind = 'household' then
    v_household_id := public.current_household_id();
    if not exists (select 1 from public.household_members where household_id = v_household_id and user_id = v_user_id and role = 'owner') then
      raise exception 'Only the household owner can invite';
    end if;
  end if;
  if (select count(*) from public.app_invites
      where created_by = v_user_id and used_at is null and revoked_at is null and expires_at > now()) >= 5 then
    raise exception 'Invite limit reached';
  end if;
  loop
    -- gen_random_uuid viene de serie en PostgreSQL (pgcrypto en Supabase vive en otro esquema).
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code := '';
    -- Bytes 0-5 y 10-11: los 6 y 8 del uuid no son aleatorios (marcan versión y variante).
    foreach v_index in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_index) % length(v_alphabet)) + 1, 1);
    end loop;
    begin
      insert into public.app_invites (code, created_by, kind, household_id)
      values (v_code, v_user_id, p_kind, v_household_id) returning * into v_invite;
      return v_invite;
    exception when unique_violation then
      -- Código repetido (muy improbable): se genera otro.
    end;
  end loop;
end;
$$;

-- Preferencias del hogar -----------------------------------------------------

create table if not exists public.household_settings (
  household_id uuid primary key references public.households(id) on delete cascade default public.current_household_id(),
  default_servings int not null default 2 check (default_servings between 1 and 20),
  week_starts_on smallint not null default 1 check (week_starts_on in (0, 1)),
  visible_meals text[] not null default '{desayuno,almuerzo,comida,merienda,cena}',
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

drop trigger if exists household_settings_set_updated_at on public.household_settings;
create trigger household_settings_set_updated_at
before update on public.household_settings
for each row execute function public.set_updated_at();

-- Cada hogar personal empieza con las preferencias que ya tenía su cuenta.
insert into public.household_settings (household_id, default_servings, week_starts_on, visible_meals, updated_by)
select h.id, s.default_servings, s.week_starts_on, s.visible_meals, s.user_id
from public.user_settings s
join public.households h on h.personal_for = s.user_id
on conflict (household_id) do nothing;

alter table public.household_settings enable row level security;
drop policy if exists "household settings" on public.household_settings;
create policy "household settings" on public.household_settings
  for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

-- Consultas para Ajustes → Hogar ---------------------------------------------

-- Hogares del usuario, con cuál está viendo y cuántas personas hay en cada uno.
create or replace function public.my_households()
returns table (id uuid, name text, is_personal boolean, role text, member_count integer, is_current boolean)
language sql
stable
security definer
set search_path = public
as $$
  select h.id, h.name, coalesce(h.personal_for = auth.uid(), false), m.role,
    (select count(*)::integer from public.household_members x where x.household_id = h.id),
    h.id = public.current_household_id()
  from public.household_members m
  join public.households h on h.id = m.household_id
  where m.user_id = auth.uid()
  order by coalesce(h.personal_for = auth.uid(), false) desc, h.name
$$;

-- Personas de un hogar del que se es miembro (con su correo, que no se ve de otra forma).
create or replace function public.household_member_list(p_household_id uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, u.email::text, m.role, m.joined_at, m.user_id = auth.uid()
  from public.household_members m
  left join auth.users u on u.id = m.user_id
  where m.household_id = p_household_id
    and exists (select 1 from public.household_members me where me.household_id = p_household_id and me.user_id = auth.uid())
  order by m.role = 'owner' desc, m.joined_at
$$;

-- Gestión del hogar (ninguna función borra datos) ----------------------------

-- Deja `p_household_id` como hogar activo del usuario.
create or replace function public.set_active_household(p_user_id uuid, p_household_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_settings (user_id, active_household_id) values (p_user_id, p_household_id)
  on conflict (user_id) do update set active_household_id = excluded.active_household_id
$$;

-- Unirse con un código de invitación a un hogar. Pasa a ser el hogar activo.
create or replace function public.join_household(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_invite public.app_invites;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_invite from public.app_invites where code = public.normalize_invite_code(p_code) for update;
  if not found or v_invite.kind <> 'household' or v_invite.used_at is not null or v_invite.revoked_at is not null or v_invite.expires_at <= now() then
    raise exception 'Invalid invite code';
  end if;
  if exists (select 1 from public.household_members where household_id = v_invite.household_id and user_id = v_user_id) then
    raise exception 'Already a member';
  end if;
  insert into public.household_members (household_id, user_id, role) values (v_invite.household_id, v_user_id, 'member');
  update public.app_invites
  set used_by = v_user_id, used_email = (select email from auth.users where id = v_user_id), used_at = now()
  where code = v_invite.code;
  perform public.set_active_household(v_user_id, v_invite.household_id);
  return v_invite.household_id;
end;
$$;

-- Cambiar de hogar: solo cambia lo que se ve. Se sigue siendo miembro de todos.
create or replace function public.switch_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.household_members where household_id = p_household_id and user_id = auth.uid()) then
    raise exception 'Not a member of this household';
  end if;
  perform public.set_active_household(auth.uid(), p_household_id);
end;
$$;

-- Copia al hogar personal lo que el usuario añadió en otro hogar: sus recetas (con
-- ingredientes y pasos), sus compras (con sus líneas, sin tocar la despensa), sus
-- traducciones de tickets y los productos que usan, sin duplicar los que ya tiene.
create or replace function public.copy_my_data_to_personal(p_household_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_target uuid;
  v_source_name text;
  v_map jsonb := '{}'::jsonb;
  v_ingredient record;
  v_new_id uuid;
  v_recipe record;
  v_purchase record;
  v_name text;
  v_products integer := 0;
  v_recipes integer := 0;
  v_purchases integer := 0;
  v_aliases integer;
begin
  select id into v_target from public.households where personal_for = v_user_id;
  if v_target is null or v_target = p_household_id then raise exception 'Nothing to copy'; end if;
  select name into v_source_name from public.households where id = p_household_id;

  -- Productos que hacen falta: los de sus recetas, sus compras y sus traducciones.
  for v_ingredient in
    select i.* from public.ingredients i
    where i.household_id = p_household_id and i.id in (
      select ri.ingredient_id from public.recipe_ingredients ri join public.recipes r on r.id = ri.recipe_id
        where r.household_id = p_household_id and r.user_id = v_user_id
      union select pi.ingredient_id from public.purchase_items pi join public.purchases p on p.id = pi.purchase_id
        where p.household_id = p_household_id and p.user_id = v_user_id and pi.ingredient_id is not null
      union select a.ingredient_id from public.receipt_aliases a
        where a.household_id = p_household_id and a.user_id = v_user_id)
  loop
    select id into v_new_id from public.ingredients
    where household_id = v_target and lower(trim(name)) = lower(trim(v_ingredient.name))
    order by name = v_ingredient.name desc limit 1;
    if v_new_id is null then
      insert into public.ingredients (household_id, user_id, name, category, default_unit)
      values (v_target, v_user_id, v_ingredient.name, v_ingredient.category, v_ingredient.default_unit)
      returning id into v_new_id;
      v_products := v_products + 1;
    end if;
    v_map := v_map || jsonb_build_object(v_ingredient.id::text, v_new_id);
  end loop;

  -- Recetas: si ya hay una con el mismo nombre, la copia lleva el nombre del hogar.
  for v_recipe in select * from public.recipes where household_id = p_household_id and user_id = v_user_id loop
    v_name := v_recipe.name;
    if exists (select 1 from public.recipes where household_id = v_target and lower(trim(name)) = lower(trim(v_name))) then
      v_name := left(v_name || ' (de ' || coalesce(v_source_name, 'otro hogar') || ')', 200);
    end if;
    v_new_id := gen_random_uuid();
    insert into public.recipes
    select (jsonb_populate_record(null::public.recipes, to_jsonb(v_recipe)
      || jsonb_build_object('id', v_new_id, 'household_id', v_target, 'user_id', v_user_id, 'name', v_name))).*;
    insert into public.recipe_ingredients (recipe_id, ingredient_id, quantity, unit, notes, sort_order)
    select v_new_id, (v_map->>ri.ingredient_id::text)::uuid, ri.quantity, ri.unit, ri.notes, ri.sort_order
    from public.recipe_ingredients ri where ri.recipe_id = v_recipe.id;
    insert into public.recipe_steps (recipe_id, step_number, instruction)
    select v_new_id, s.step_number, s.instruction from public.recipe_steps s where s.recipe_id = v_recipe.id;
    v_recipes := v_recipes + 1;
  end loop;

  -- Compras: solo como historial. No cambian la despensa del hogar personal, y
  -- borrarlas después tampoco la toca (no queda apuntado ningún efecto en ella).
  for v_purchase in select * from public.purchases where household_id = p_household_id and user_id = v_user_id loop
    v_new_id := gen_random_uuid();
    insert into public.purchases
    select (jsonb_populate_record(null::public.purchases, to_jsonb(v_purchase)
      || jsonb_build_object('id', v_new_id, 'household_id', v_target, 'user_id', v_user_id))).*;
    insert into public.purchase_items
    select (jsonb_populate_record(null::public.purchase_items, to_jsonb(pi)
      || jsonb_build_object('id', gen_random_uuid(), 'purchase_id', v_new_id,
           'ingredient_id', case when pi.ingredient_id is null then null else v_map->>pi.ingredient_id::text end,
           'pantry_effect_applied', false, 'pantry_added_quantity', null, 'pantry_added_unit', null,
           'pantry_status_before', null, 'pantry_status_changed', false))).*
    from public.purchase_items pi where pi.purchase_id = v_purchase.id;
    v_purchases := v_purchases + 1;
  end loop;

  -- Traducciones de tickets que aún no tenga.
  insert into public.receipt_aliases (household_id, user_id, raw_name, normalized_name, ingredient_id)
  select v_target, v_user_id, a.raw_name, a.normalized_name, (v_map->>a.ingredient_id::text)::uuid
  from public.receipt_aliases a
  where a.household_id = p_household_id and a.user_id = v_user_id
  on conflict (household_id, normalized_name) do nothing;
  get diagnostics v_aliases = row_count;

  return jsonb_build_object('products', v_products, 'recipes', v_recipes, 'purchases', v_purchases, 'aliases', v_aliases);
end;
$$;

-- Salir de un hogar (nunca del personal). Lo añadido se queda en el hogar para
-- los demás; con p_copy se lleva antes una copia de lo suyo al hogar personal.
create or replace function public.leave_household(p_household_id uuid, p_copy boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_copied jsonb := '{}'::jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.household_members where household_id = p_household_id and user_id = v_user_id for update;
  if not found then raise exception 'Not a member of this household'; end if;
  if exists (select 1 from public.households where id = p_household_id and personal_for = v_user_id) then
    raise exception 'Cannot leave the personal household';
  end if;
  if p_copy then v_copied := public.copy_my_data_to_personal(p_household_id); end if;
  delete from public.household_members where household_id = p_household_id and user_id = v_user_id;
  -- Si se va el responsable, lo pasa a ser quien lleve más tiempo.
  if v_role = 'owner' and not exists (select 1 from public.household_members where household_id = p_household_id and role = 'owner') then
    update public.household_members set role = 'owner'
    where (household_id, user_id) = (select household_id, user_id from public.household_members
                                     where household_id = p_household_id order by joined_at limit 1);
  end if;
  perform public.set_active_household(v_user_id, (select id from public.households where personal_for = v_user_id));
  return v_copied;
end;
$$;

-- El responsable quita a alguien del hogar actual. Como si saliera: no se borra
-- nada y esa persona vuelve a su hogar personal.
create or replace function public.remove_household_member(p_household_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.household_members where household_id = p_household_id and user_id = auth.uid() and role = 'owner') then
    raise exception 'Only the household owner can remove members';
  end if;
  if p_user_id = auth.uid() then raise exception 'Use leave_household to leave'; end if;
  if exists (select 1 from public.households where id = p_household_id and personal_for = p_user_id) then
    raise exception 'Cannot leave the personal household';
  end if;
  delete from public.household_members where household_id = p_household_id and user_id = p_user_id;
  if not found then raise exception 'Not a member of this household'; end if;
end;
$$;

create or replace function public.rename_household(p_household_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.household_members where household_id = p_household_id and user_id = auth.uid() and role = 'owner') then
    raise exception 'Only the household owner can rename it';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'Invalid household name'; end if;
  update public.households set name = trim(p_name) where id = p_household_id;
end;
$$;

-- Cuenta nueva: hogar personal y productos básicos, y si la invitación era a un
-- hogar, entra también en él y lo ve directamente.
create or replace function public.seed_basic_ingredients_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_invited_to uuid;
begin
  v_household_id := public.ensure_personal_household(new.id, new.email);
  perform public.seed_basic_ingredients_for_household(v_household_id, new.id);
  select household_id into v_invited_to from public.app_invites
  where used_by = new.id and kind = 'household' and household_id is not null
  order by used_at desc limit 1;
  if v_invited_to is not null then
    insert into public.household_members (household_id, user_id, role) values (v_invited_to, new.id, 'member')
    on conflict (household_id, user_id) do nothing;
    perform public.set_active_household(new.id, v_invited_to);
  end if;
  return new;
end;
$$;

revoke execute on function public.create_app_invite(text) from public, anon;
revoke execute on function public.my_households() from public, anon;
revoke execute on function public.household_member_list(uuid) from public, anon;
revoke execute on function public.set_active_household(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.join_household(text) from public, anon;
revoke execute on function public.switch_household(uuid) from public, anon;
revoke execute on function public.copy_my_data_to_personal(uuid) from public, anon, authenticated;
revoke execute on function public.leave_household(uuid, boolean) from public, anon;
revoke execute on function public.remove_household_member(uuid, uuid) from public, anon;
revoke execute on function public.rename_household(uuid, text) from public, anon;
grant execute on function public.create_app_invite(text) to authenticated;
grant execute on function public.my_households() to authenticated;
grant execute on function public.household_member_list(uuid) to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.switch_household(uuid) to authenticated;
grant execute on function public.leave_household(uuid, boolean) to authenticated;
grant execute on function public.remove_household_member(uuid, uuid) to authenticated;
grant execute on function public.rename_household(uuid, text) to authenticated;
grant select, insert, update on public.household_settings to authenticated;

commit;
