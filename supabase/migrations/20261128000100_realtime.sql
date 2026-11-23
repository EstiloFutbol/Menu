-- Modo hogar, fase 4: ver al momento lo que cambian los demás.
--
-- Añade a la publicación de Supabase Realtime las tablas que se comparten en el
-- hogar. La app escucha sus cambios y recarga lo que se está viendo.
-- * Realtime respeta la seguridad (RLS): cada persona solo recibe los cambios de
--   las filas que puede ver, es decir, las de su hogar.
-- * No modifica ninguna fila ni ninguna tabla: solo dice qué tablas se publican.
-- * Se puede ejecutar varias veces: las tablas que ya estén publicadas se saltan.

begin;

do $$
declare
  v_table text;
begin
  -- En Supabase la publicación ya existe; en una base de datos de prueba se crea vacía.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach v_table in array array[
    'shopping_lists', 'shopping_items', 'quick_list_items',
    'menu_entries', 'menu_entry_recipes', 'menu_entry_products', 'menu_day_notes', 'consumption_logs',
    'pantry_items', 'ingredients', 'recipes', 'purchases',
    'household_settings', 'household_members', 'households'
  ] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;

commit;
