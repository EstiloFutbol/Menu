-- Sustituto mínimo del esquema auth de Supabase para probar las migraciones en un
-- PostgreSQL local. auth.uid() lee el usuario de `request.jwt.claim.sub`.
-- Los roles son de todo el servidor: se crean solo si no existen (hay dos bases de datos de prueba).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create schema auth;
grant usage on schema auth to authenticated, anon;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
