-- Huella de todos los datos justo antes de la fase 2 del hogar (como en producción,
-- con la fase 1 ya aplicada). Tras aplicarla se comprueba que no ha cambiado nada.
create table public._fingerprint as
select t.name,
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t.name), false, true, '')))[1]::text::int as rows,
  (xpath('/row/h/text()', query_to_xml(format(
    'select md5(coalesce(string_agg(r, ''|'' order by r), '''')) as h from (select (to_jsonb(x) - ''household_id'')::text as r from public.%I x) s', t.name), false, true, '')))[1]::text as hash
from (values ('households'), ('household_members'), ('user_settings'), ('app_invites'),
             ('ingredients'), ('recipes'), ('recipe_ingredients'), ('recipe_steps'), ('menu_entries'), ('menu_entry_recipes'), ('menu_entry_products'),
             ('pantry_items'), ('shopping_lists'), ('shopping_items'), ('purchases'), ('purchase_items'), ('consumption_logs'), ('consumption_ingredients'),
             ('receipt_aliases')) as t(name);
