-- Ajusta la precisión de los números guardados a la que usa la app:
-- cantidades y dinero con 2 decimales, nutrición con 1 y envases enteros.
-- Cambiar el tipo de la columna redondea los datos existentes y hace que
-- cualquier valor nuevo, también los calculados en SQL, se guarde redondeado.

-- Cantidades que deben ser mayores que 0: un valor por debajo de 0,005 se
-- redondearía a 0 e incumpliría la restricción, así que se sube a 0,01.
update public.recipe_ingredients set quantity = 0.01 where quantity > 0 and quantity < 0.005;
update public.menu_entry_products set quantity = 0.01 where quantity > 0 and quantity < 0.005;
update public.shopping_items set quantity = 0.01 where quantity > 0 and quantity < 0.005;
update public.purchase_items set quantity = 0.01 where quantity > 0 and quantity < 0.005;

alter table public.recipe_ingredients alter column quantity type numeric(12,2);
alter table public.menu_entry_products alter column quantity type numeric(12,2);
alter table public.pantry_items alter column quantity type numeric(12,2);
alter table public.shopping_items alter column quantity type numeric(12,2);
alter table public.purchase_items alter column quantity type numeric(12,2);
alter table public.purchase_items alter column pantry_added_quantity type numeric(12,2);
alter table public.consumption_ingredients alter column quantity type numeric(12,2);

-- Precio de referencia (€/kg, €/l…) con 2 decimales, como el resto de importes.
alter table public.purchase_items alter column reference_unit_price type numeric(10,2);

-- Valores nutricionales por ración con 1 decimal.
alter table public.recipes
  alter column calories_per_serving type numeric(10,1),
  alter column protein_g_per_serving type numeric(10,1),
  alter column carbs_g_per_serving type numeric(10,1),
  alter column fiber_g_per_serving type numeric(10,1),
  alter column fat_g_per_serving type numeric(10,1),
  alter column sugar_g_per_serving type numeric(10,1);

-- Envases enteros. Se mantiene el tipo para no tocar las funciones que lo usan;
-- solo se redondean los valores con decimales, con un mínimo de 1.
update public.purchase_items
set packages = greatest(round(packages), 1)
where packages is not null and packages <> round(packages);
