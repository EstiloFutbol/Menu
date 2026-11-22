-- Productos básicos de partida, para no tener que crear el catálogo desde cero.
-- * Las cuentas nuevas los reciben automáticamente al registrarse.
-- * Las cuentas que ya existen los reciben al aplicar esta migración.
-- * Desde la app (Despensa → Productos → «Añadir productos básicos») se pueden
--   volver a añadir los que falten.
-- Nunca se duplica nada: se salta un producto básico si la cuenta ya tiene uno
-- con el mismo nombre (sin tener en cuenta mayúsculas ni tildes) o uno más
-- concreto que empiece igual («Salmón noruego» cuenta como «Salmón»).
-- Solo se crean en el catálogo: no se añade nada a la despensa.

create or replace function public.basic_ingredient_catalog()
returns table (name text, category text, default_unit public.measurement_unit)
language sql
immutable
set search_path = public
as $$
  select t.name, t.category, t.default_unit::public.measurement_unit from (values
    -- Fruta y verdura
    ('Tomate', 'Fruta y verdura', 'g'), ('Cebolla', 'Fruta y verdura', 'g'), ('Ajo', 'Fruta y verdura', 'unidad'),
    ('Patata', 'Fruta y verdura', 'g'), ('Zanahoria', 'Fruta y verdura', 'g'), ('Pimiento rojo', 'Fruta y verdura', 'g'),
    ('Pimiento verde', 'Fruta y verdura', 'g'), ('Calabacín', 'Fruta y verdura', 'g'), ('Berenjena', 'Fruta y verdura', 'g'),
    ('Calabaza', 'Fruta y verdura', 'g'), ('Pepino', 'Fruta y verdura', 'unidad'), ('Lechuga', 'Fruta y verdura', 'unidad'),
    ('Espinacas', 'Fruta y verdura', 'g'), ('Brócoli', 'Fruta y verdura', 'g'), ('Coliflor', 'Fruta y verdura', 'g'),
    ('Champiñones', 'Fruta y verdura', 'g'), ('Puerro', 'Fruta y verdura', 'unidad'), ('Apio', 'Fruta y verdura', 'g'),
    ('Judías verdes', 'Fruta y verdura', 'g'), ('Boniato', 'Fruta y verdura', 'g'), ('Perejil fresco', 'Fruta y verdura', 'g'),
    ('Cilantro fresco', 'Fruta y verdura', 'g'), ('Albahaca fresca', 'Fruta y verdura', 'g'), ('Jengibre', 'Fruta y verdura', 'g'),
    ('Limón', 'Fruta y verdura', 'unidad'), ('Lima', 'Fruta y verdura', 'unidad'), ('Naranja', 'Fruta y verdura', 'unidad'),
    ('Manzana', 'Fruta y verdura', 'unidad'), ('Plátano', 'Fruta y verdura', 'unidad'), ('Pera', 'Fruta y verdura', 'unidad'),
    ('Fresas', 'Fruta y verdura', 'g'), ('Uvas', 'Fruta y verdura', 'g'), ('Kiwi', 'Fruta y verdura', 'unidad'),
    ('Aguacate', 'Fruta y verdura', 'unidad'),
    -- Carne
    ('Pechuga de pollo', 'Carne', 'g'), ('Muslos de pollo', 'Carne', 'g'), ('Carne picada de ternera', 'Carne', 'g'),
    ('Carne picada mixta', 'Carne', 'g'), ('Filetes de ternera', 'Carne', 'g'), ('Lomo de cerdo', 'Carne', 'g'),
    ('Costillas de cerdo', 'Carne', 'g'), ('Jamón serrano', 'Carne', 'g'), ('Jamón cocido', 'Carne', 'g'),
    ('Pavo en lonchas', 'Carne', 'g'), ('Chorizo', 'Carne', 'g'), ('Bacon', 'Carne', 'g'), ('Salchichas', 'Carne', 'unidad'),
    -- Pescado y marisco
    ('Salmón', 'Pescado y marisco', 'g'), ('Merluza', 'Pescado y marisco', 'g'), ('Bacalao', 'Pescado y marisco', 'g'),
    ('Atún en lata', 'Pescado y marisco', 'lata'), ('Gambas', 'Pescado y marisco', 'g'), ('Langostinos', 'Pescado y marisco', 'g'),
    ('Mejillones', 'Pescado y marisco', 'g'), ('Sardinas', 'Pescado y marisco', 'g'), ('Calamares', 'Pescado y marisco', 'g'),
    -- Lácteos y huevos
    ('Huevos', 'Lácteos y huevos', 'unidad'), ('Leche', 'Lácteos y huevos', 'l'), ('Yogur natural', 'Lácteos y huevos', 'unidad'),
    ('Queso rallado', 'Lácteos y huevos', 'g'), ('Queso fresco', 'Lácteos y huevos', 'g'), ('Queso curado', 'Lácteos y huevos', 'g'),
    ('Mozzarella', 'Lácteos y huevos', 'g'), ('Mantequilla', 'Lácteos y huevos', 'g'), ('Nata para cocinar', 'Lácteos y huevos', 'ml'),
    -- Panadería
    ('Pan', 'Panadería', 'unidad'), ('Pan de molde', 'Panadería', 'paquete'), ('Pan rallado', 'Panadería', 'g'),
    ('Tortillas de trigo', 'Panadería', 'paquete'),
    -- Despensa
    ('Arroz', 'Despensa', 'g'), ('Arroz integral', 'Despensa', 'g'), ('Pasta', 'Despensa', 'g'), ('Espaguetis', 'Despensa', 'g'),
    ('Macarrones', 'Despensa', 'g'), ('Fideos', 'Despensa', 'g'), ('Harina', 'Despensa', 'g'), ('Azúcar', 'Despensa', 'g'),
    ('Aceite de oliva virgen extra', 'Despensa', 'ml'), ('Aceite de girasol', 'Despensa', 'ml'), ('Lentejas', 'Despensa', 'g'),
    ('Garbanzos cocidos', 'Despensa', 'g'), ('Alubias blancas cocidas', 'Despensa', 'g'), ('Tomate triturado', 'Despensa', 'g'),
    ('Tomate frito', 'Despensa', 'g'), ('Caldo de pollo', 'Despensa', 'ml'), ('Caldo de verduras', 'Despensa', 'ml'),
    ('Copos de avena', 'Despensa', 'g'), ('Quinoa', 'Despensa', 'g'), ('Maíz dulce', 'Despensa', 'g'), ('Aceitunas', 'Despensa', 'g'),
    ('Almendras', 'Despensa', 'g'), ('Nueces', 'Despensa', 'g'), ('Miel', 'Despensa', 'g'), ('Cacao en polvo', 'Despensa', 'g'),
    ('Café', 'Despensa', 'g'), ('Levadura', 'Despensa', 'paquete'), ('Galletas', 'Despensa', 'paquete'), ('Cereales', 'Despensa', 'g'),
    -- Congelados
    ('Guisantes congelados', 'Congelados', 'g'), ('Verduras congeladas', 'Congelados', 'g'), ('Espinacas congeladas', 'Congelados', 'g'),
    -- Bebidas
    ('Agua', 'Bebidas', 'l'), ('Bebida vegetal', 'Bebidas', 'l'), ('Zumo de naranja', 'Bebidas', 'l'), ('Vino blanco', 'Bebidas', 'ml'),
    ('Vino tinto', 'Bebidas', 'ml'), ('Cerveza', 'Bebidas', 'unidad'),
    -- Salsas y condimentos
    ('Sal', 'Salsas y condimentos', 'g'), ('Pimienta negra', 'Salsas y condimentos', 'g'), ('Pimentón dulce', 'Salsas y condimentos', 'cucharadita'),
    ('Comino molido', 'Salsas y condimentos', 'cucharadita'), ('Orégano', 'Salsas y condimentos', 'cucharadita'), ('Canela', 'Salsas y condimentos', 'cucharadita'),
    ('Curry', 'Salsas y condimentos', 'cucharadita'), ('Cúrcuma', 'Salsas y condimentos', 'cucharadita'), ('Laurel', 'Salsas y condimentos', 'unidad'),
    ('Tomillo', 'Salsas y condimentos', 'cucharadita'), ('Nuez moscada', 'Salsas y condimentos', 'cucharadita'), ('Vinagre', 'Salsas y condimentos', 'ml'),
    ('Salsa de soja', 'Salsas y condimentos', 'ml'), ('Mostaza', 'Salsas y condimentos', 'g'), ('Mayonesa', 'Salsas y condimentos', 'g'),
    ('Ketchup', 'Salsas y condimentos', 'g')
  ) as t(name, category, default_unit)
$$;

-- Añade a una cuenta los productos básicos que le falten. Devuelve cuántos ha añadido.
-- Con RLS, una cuenta solo puede añadirlos a sí misma.
create or replace function public.seed_basic_ingredients(p_user_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_added integer;
begin
  insert into public.ingredients (user_id, name, category, default_unit)
  select p_user_id, b.name, b.category, b.default_unit
  from public.basic_ingredient_catalog() b
  where not exists (
    select 1 from public.ingredients i
    where i.user_id = p_user_id
      and (public.normalize_receipt_name(i.name) = public.normalize_receipt_name(b.name)
        or public.normalize_receipt_name(i.name) like public.normalize_receipt_name(b.name) || ' %')
  )
  on conflict (user_id, name) do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

-- Botón de la app: añade a la cuenta con sesión iniciada los básicos que falten.
create or replace function public.add_basic_ingredients()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  return public.seed_basic_ingredients(auth.uid());
end;
$$;

-- Cuentas nuevas: al registrarse reciben los básicos. Se ejecuta con los permisos
-- del propietario porque en el alta todavía no hay sesión.
create or replace function public.seed_basic_ingredients_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_basic_ingredients(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_seed_ingredients on auth.users;
create trigger on_auth_user_created_seed_ingredients
  after insert on auth.users
  for each row execute function public.seed_basic_ingredients_for_new_user();

revoke execute on function public.basic_ingredient_catalog() from public, anon;
revoke execute on function public.seed_basic_ingredients(uuid) from public, anon;
revoke execute on function public.add_basic_ingredients() from public, anon;
revoke execute on function public.seed_basic_ingredients_for_new_user() from public, anon, authenticated;
grant execute on function public.basic_ingredient_catalog() to authenticated;
grant execute on function public.seed_basic_ingredients(uuid) to authenticated;
grant execute on function public.add_basic_ingredients() to authenticated;

-- Cuentas que ya existen.
do $$
declare
  v_user record;
begin
  for v_user in select id from auth.users loop
    perform public.seed_basic_ingredients(v_user.id);
  end loop;
end $$;
