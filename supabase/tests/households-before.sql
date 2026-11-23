-- Datos de dos cuentas ANTES de la migración del hogar (como en producción).
alter table auth.users disable trigger before_auth_user_created_require_invite;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@prueba.es'),
  ('00000000-0000-0000-0000-00000000000b', 'beto@prueba.es');
alter table auth.users enable trigger before_auth_user_created_require_invite;
grant usage on schema public to authenticated, anon;
grant all on all tables in schema public to authenticated;

-- Ana: receta, menú (con consumo), despensa, ticket y lista de la compra.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.save_recipe(null, '{"name":"Lentejas","base_servings":2}',
  (select jsonb_agg(jsonb_build_object('ingredient_id', id, 'name', name, 'category', category, 'quantity', 100, 'unit', 'g')) from public.ingredients where name in ('Lentejas', 'Cebolla')),
  '["Cocer"]');
insert into public.pantry_items (user_id, ingredient_id, quantity, unit) select auth.uid(), id, 500, 'g' from public.ingredients where name = 'Lentejas';
select public.save_menu_slot('2026-11-23', 'comida', false, (select jsonb_build_array(jsonb_build_object('recipe_id', id, 'servings', 2)) from public.recipes where name = 'Lentejas'), '[]');
select public.complete_planned_recipe((select mer.id from public.menu_entry_recipes mer join public.menu_entries me on me.id = mer.menu_entry_id where me.planned_date = '2026-11-23'), 2,
  (select jsonb_build_array(jsonb_build_object('ingredient_id', id, 'quantity', 100, 'unit', 'g')) from public.ingredients where name = 'Lentejas'));
select public.import_reviewed_receipt('Mercadona', now(), 3.5,
  '[{"raw_name":"PAN","canonical_name":"Pan","normalized_name":"pan","ingredient_id":null,"category":"Panadería","quantity":1,"unit":"unidad","total_price":1.2,"add_to_pantry":true},
    {"raw_name":"LECHE ENTERA","canonical_name":"Leche entera","normalized_name":"leche entera","ingredient_id":null,"category":"Lácteos y huevos","quantity":1,"unit":"l","total_price":2.3,"add_to_pantry":true}]');
select public.regenerate_shopping_list('2026-11-23', (select jsonb_build_array(jsonb_build_object('ingredient_id', id, 'quantity', 1, 'unit', 'unidad')) from public.ingredients where name = 'Huevos'));
reset role;

-- Beto: una receta y su despensa.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.save_recipe(null, '{"name":"Tortilla","base_servings":2}',
  (select jsonb_agg(jsonb_build_object('ingredient_id', id, 'name', name, 'category', category, 'quantity', 4, 'unit', 'unidad')) from public.ingredients where name = 'Huevos'),
  '["Batir"]');
insert into public.pantry_items (user_id, ingredient_id, quantity, unit) select auth.uid(), id, 6, 'unidad' from public.ingredients where name = 'Huevos';
reset role;

-- Recuento antes de migrar.
create table public._before as
select t.name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.name), false, true, '')))[1]::text::int as rows
from (values ('ingredients'), ('recipes'), ('recipe_ingredients'), ('recipe_steps'), ('menu_entries'), ('menu_entry_recipes'), ('menu_entry_products'),
             ('pantry_items'), ('shopping_lists'), ('shopping_items'), ('purchases'), ('purchase_items'), ('consumption_logs'), ('consumption_ingredients'), ('receipt_aliases')) as t(name);
