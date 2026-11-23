-- Modo hogar, fase 3: modo sencillo.
--
-- * household_settings.mode: 'completo' (como hasta ahora) o 'sencillo'. Es del
--   hogar y SOLO cambia qué se muestra: cambiarlo no toca ningún otro dato.
-- * menu_day_notes: el menú sencillo, un texto por día.
-- * quick_list_items: la lista de la compra sencilla, escrita a mano.
-- * Las dos tablas nacen con household_id, seguridad por hogar y autor.
-- * No modifica ninguna fila existente: las cuentas actuales siguen en modo completo.

-- Todo o nada: si algo fallara a mitad, no se aplica ningún cambio.
begin;

alter table public.household_settings
  add column if not exists mode text not null default 'completo' check (mode in ('sencillo', 'completo'));

-- Quién cambió algo por última vez (lo pone la base de datos, no la app).
create or replace function public.set_updated_by()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

-- Menú sencillo -----------------------------------------------------------------

create table if not exists public.menu_day_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id() references public.households(id) on delete restrict,
  day date not null,
  text text not null default '' check (length(text) <= 2000),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint menu_day_notes_household_day_key unique (household_id, day)
);

drop trigger if exists menu_day_notes_set_updated on public.menu_day_notes;
create trigger menu_day_notes_set_updated
before update on public.menu_day_notes
for each row execute function public.set_updated_by();

alter table public.menu_day_notes enable row level security;
drop policy if exists "household day notes" on public.menu_day_notes;
create policy "household day notes" on public.menu_day_notes
  for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

-- Lista sencilla ----------------------------------------------------------------

create table if not exists public.quick_list_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id() references public.households(id) on delete restrict,
  text text not null check (length(trim(text)) between 1 and 200),
  checked boolean not null default false,
  position integer not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists quick_list_items_household_idx on public.quick_list_items (household_id, position);

drop trigger if exists quick_list_items_set_updated on public.quick_list_items;
create trigger quick_list_items_set_updated
before update on public.quick_list_items
for each row execute function public.set_updated_by();

alter table public.quick_list_items enable row level security;
drop policy if exists "household quick list" on public.quick_list_items;
create policy "household quick list" on public.quick_list_items
  for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

-- Copiar la semana del menú sencillo: cada día con texto pasa al mismo día de la
-- semana de destino, pero SOLO si allí está vacío. Nunca se sobrescribe nada.
create or replace function public.copy_day_notes(p_from_week date, p_to_week date)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_household_id uuid := public.current_household_id();
  v_note record;
  v_copied integer := 0;
  v_kept integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_from_week = p_to_week then raise exception 'Choose a different week'; end if;
  for v_note in
    select day, text from public.menu_day_notes
    where household_id = v_household_id and day between p_from_week and p_from_week + 6 and trim(text) <> ''
  loop
    insert into public.menu_day_notes (household_id, day, text)
    values (v_household_id, p_to_week + (v_note.day - p_from_week), v_note.text)
    on conflict (household_id, day) do update set text = excluded.text
      where trim(public.menu_day_notes.text) = '';
    if found then v_copied := v_copied + 1; else v_kept := v_kept + 1; end if;
  end loop;
  return jsonb_build_object('copied', v_copied, 'kept', v_kept);
end;
$$;

revoke execute on function public.copy_day_notes(date, date) from public, anon;
grant execute on function public.copy_day_notes(date, date) to authenticated;
grant select, insert, update, delete on public.menu_day_notes, public.quick_list_items to authenticated;

commit;
