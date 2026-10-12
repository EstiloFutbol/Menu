-- Endurecimiento de seguridad.
--
-- 1. Referencias cruzadas entre usuarios. Las políticas solo comprobaban que la
--    fila "padre" fuera del usuario (la receta, la franja, la compra...), pero no
--    que lo que se enlaza también lo fuera. Así, alguien que conociera el id de un
--    producto o una receta de otra persona podía enlazarlo desde sus datos y, por
--    ejemplo, impedir que esa persona lo borrase (las claves son "on delete
--    restrict"). Ahora, al crear o modificar una fila, todo lo que enlaza tiene
--    que ser del propio usuario. Las lecturas no cambian.
--
-- 2. Las funciones de la app solo las puede ejecutar un usuario autenticado. Ya
--    rechazaban a quien no hubiera iniciado sesión, pero por defecto Supabase
--    deja ejecutarlas también al rol anónimo.

drop policy if exists "own recipe ingredients" on public.recipe_ingredients;
create policy "own recipe ingredients" on public.recipe_ingredients
for all
using (exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid()))
with check (
  exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid())
  and exists (select 1 from public.ingredients i where i.id = ingredient_id and i.user_id = auth.uid())
);

drop policy if exists "own menu recipes" on public.menu_entry_recipes;
create policy "own menu recipes" on public.menu_entry_recipes
for all
using (exists (select 1 from public.menu_entries m where m.id = menu_entry_id and m.user_id = auth.uid()))
with check (
  exists (select 1 from public.menu_entries m where m.id = menu_entry_id and m.user_id = auth.uid())
  and exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid())
);

drop policy if exists "own menu products" on public.menu_entry_products;
create policy "own menu products" on public.menu_entry_products
for all
using (exists (select 1 from public.menu_entries m where m.id = menu_entry_id and m.user_id = auth.uid()))
with check (
  exists (select 1 from public.menu_entries m where m.id = menu_entry_id and m.user_id = auth.uid())
  and exists (select 1 from public.ingredients i where i.id = ingredient_id and i.user_id = auth.uid())
);

drop policy if exists "own pantry" on public.pantry_items;
create policy "own pantry" on public.pantry_items
for all
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (select 1 from public.ingredients i where i.id = ingredient_id and i.user_id = auth.uid())
);

drop policy if exists "own shopping items" on public.shopping_items;
create policy "own shopping items" on public.shopping_items
for all
using (exists (select 1 from public.shopping_lists s where s.id = shopping_list_id and s.user_id = auth.uid()))
with check (
  exists (select 1 from public.shopping_lists s where s.id = shopping_list_id and s.user_id = auth.uid())
  and (ingredient_id is null or exists (select 1 from public.ingredients i where i.id = ingredient_id and i.user_id = auth.uid()))
);

drop policy if exists "own purchase items" on public.purchase_items;
create policy "own purchase items" on public.purchase_items
for all
using (exists (select 1 from public.purchases p where p.id = purchase_id and p.user_id = auth.uid()))
with check (
  exists (select 1 from public.purchases p where p.id = purchase_id and p.user_id = auth.uid())
  and (ingredient_id is null or exists (select 1 from public.ingredients i where i.id = ingredient_id and i.user_id = auth.uid()))
);

drop policy if exists "own consumption logs" on public.consumption_logs;
create policy "own consumption logs" on public.consumption_logs
for all
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and (menu_entry_id is null or exists (select 1 from public.menu_entries m where m.id = menu_entry_id and m.user_id = auth.uid()))
  and (recipe_id is null or exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid()))
  and (menu_entry_recipe_id is null or exists (
    select 1 from public.menu_entry_recipes mer
    join public.menu_entries m on m.id = mer.menu_entry_id
    where mer.id = menu_entry_recipe_id and m.user_id = auth.uid()
  ))
  and (menu_entry_product_id is null or exists (
    select 1 from public.menu_entry_products mep
    join public.menu_entries m on m.id = mep.menu_entry_id
    where mep.id = menu_entry_product_id and m.user_id = auth.uid()
  ))
);

drop policy if exists "own consumption ingredients" on public.consumption_ingredients;
create policy "own consumption ingredients" on public.consumption_ingredients
for all
using (exists (select 1 from public.consumption_logs c where c.id = consumption_log_id and c.user_id = auth.uid()))
with check (
  exists (select 1 from public.consumption_logs c where c.id = consumption_log_id and c.user_id = auth.uid())
  and exists (select 1 from public.ingredients i where i.id = ingredient_id and i.user_id = auth.uid())
);

drop policy if exists "own receipt aliases" on public.receipt_aliases;
create policy "own receipt aliases" on public.receipt_aliases
for all
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (select 1 from public.ingredients i where i.id = ingredient_id and i.user_id = auth.uid())
);

-- Funciones: fuera el rol anónimo y el acceso público; solo usuarios autenticados.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- Y lo mismo para las funciones que se creen a partir de ahora.
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public grant execute on functions to authenticated;
