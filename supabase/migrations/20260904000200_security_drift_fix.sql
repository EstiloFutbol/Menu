-- Alinea la base existente con la configuración de seguridad versionada.
-- La función de consumo opera con los permisos del usuario autenticado y RLS.

alter function public.complete_planned_product(uuid, numeric, public.measurement_unit)
  security invoker;

alter function public.set_updated_at()
  set search_path = public;
