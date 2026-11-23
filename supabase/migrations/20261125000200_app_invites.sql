-- Invitaciones a la app: solo se puede crear una cuenta con el código de
-- invitación de alguien que ya la usa.
-- * Cada usuario puede tener como mucho 5 invitaciones activas (sin usar, sin
--   anular y sin caducar). Cada código sirve una vez y caduca a los 7 días.
-- * Un trigger en auth.users rechaza cualquier alta sin un código válido y lo
--   marca como usado en la misma operación, así dos altas no pueden usar el
--   mismo código. Como se rechaza en la base de datos, no hay forma de saltárselo
--   llamando a Supabase sin pasar por la app.
-- * Para que funcione hay que activar en Supabase «Allow new users to sign up»,
--   SIEMPRE después de aplicar esta migración.
-- * `kind` prepara las invitaciones a un hogar (modo familiar); de momento solo
--   existen las de tipo 'app'.

create table if not exists public.app_invites (
  code text primary key check (code ~ '^[A-Z2-9]{8}$'),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'app' check (kind in ('app', 'household')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  -- Quién lo usó. Sin clave foránea: al validar, la cuenta todavía no existe.
  used_by uuid,
  used_email text,
  used_at timestamptz
);

create index if not exists app_invites_created_by_idx on public.app_invites (created_by);

alter table public.app_invites enable row level security;

-- Cada usuario ve solo sus invitaciones. Se crean y anulan con las funciones de abajo.
drop policy if exists "own invites select" on public.app_invites;
create policy "own invites select" on public.app_invites
  for select to authenticated using (created_by = auth.uid());
drop policy if exists "own invites insert" on public.app_invites;
create policy "own invites insert" on public.app_invites
  for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "own invites update" on public.app_invites;
create policy "own invites update" on public.app_invites
  for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());

-- Deja el código en el formato guardado: mayúsculas y sin guiones ni espacios ("k7mq-2pxa" → "K7MQ2PXA").
create or replace function public.normalize_invite_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- Crea una invitación. Sin 0, O, 1, I ni L para que no se confundan al dictarlos.
create or replace function public.create_app_invite()
returns public.app_invites
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  v_invite public.app_invites;
  v_bytes bytea;
  v_index integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
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
      insert into public.app_invites (code, created_by) values (v_code, v_user_id) returning * into v_invite;
      return v_invite;
    exception when unique_violation then
      -- Código repetido (muy improbable): se genera otro.
    end;
  end loop;
end;
$$;

-- Anula una invitación propia que no se ha usado.
create or replace function public.revoke_app_invite(p_code text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.app_invites set revoked_at = now()
  where code = public.normalize_invite_code(p_code) and created_by = auth.uid() and used_at is null and revoked_at is null;
  if not found then raise exception 'Invite not found'; end if;
end;
$$;

-- Para la pantalla de registro (todavía sin sesión): solo dice si el código vale.
create or replace function public.check_app_invite(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_invites
    where code = public.normalize_invite_code(p_code)
      and used_at is null and revoked_at is null and expires_at > now()
  )
$$;

-- Toda cuenta nueva necesita un código válido, que se marca como usado.
create or replace function public.require_app_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := public.normalize_invite_code(new.raw_user_meta_data->>'invite_code');
  v_invite public.app_invites;
begin
  if v_code = '' then raise exception 'Invite code required'; end if;
  select * into v_invite from public.app_invites where code = v_code for update;
  if not found or v_invite.used_at is not null or v_invite.revoked_at is not null or v_invite.expires_at <= now() then
    raise exception 'Invalid invite code';
  end if;
  update public.app_invites set used_by = new.id, used_email = new.email, used_at = now() where code = v_code;
  return new;
end;
$$;

drop trigger if exists before_auth_user_created_require_invite on auth.users;
create trigger before_auth_user_created_require_invite
  before insert on auth.users
  for each row execute function public.require_app_invite();

revoke execute on function public.normalize_invite_code(text) from public;
revoke execute on function public.create_app_invite() from public, anon;
revoke execute on function public.revoke_app_invite(text) from public, anon;
revoke execute on function public.check_app_invite(text) from public;
revoke execute on function public.require_app_invite() from public, anon, authenticated;
grant execute on function public.normalize_invite_code(text) to anon, authenticated;
grant execute on function public.create_app_invite() to authenticated;
grant execute on function public.revoke_app_invite(text) to authenticated;
grant execute on function public.check_app_invite(text) to anon, authenticated;
grant select, insert, update on public.app_invites to authenticated;
