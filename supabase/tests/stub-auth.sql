-- Sustituto mínimo del esquema auth de Supabase para probar las migraciones en un
-- PostgreSQL local. auth.uid() lee el usuario de `request.jwt.claim.sub`.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
grant usage on schema auth to authenticated, anon;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
