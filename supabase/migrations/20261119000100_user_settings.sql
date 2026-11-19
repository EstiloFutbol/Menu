-- Preferencias de planificación por usuario (raciones por defecto, inicio de semana
-- y franjas visibles). Una fila por usuario; si no existe, la app usa los valores
-- por defecto. No se concede nada al rol anónimo: solo el propio usuario accede.

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users on delete cascade default auth.uid(),
  default_servings int not null default 2 check (default_servings between 1 and 20),
  week_starts_on smallint not null default 1 check (week_starts_on in (0, 1)),
  visible_meals text[] not null default '{desayuno,almuerzo,comida,merienda,cena}',
  updated_at timestamptz not null default now()
);

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists "own settings select" on public.user_settings;
create policy "own settings select" on public.user_settings
for select using (auth.uid() = user_id);

drop policy if exists "own settings insert" on public.user_settings;
create policy "own settings insert" on public.user_settings
for insert with check (auth.uid() = user_id);

drop policy if exists "own settings update" on public.user_settings;
create policy "own settings update" on public.user_settings
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
