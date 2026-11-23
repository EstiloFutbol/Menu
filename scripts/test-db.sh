#!/usr/bin/env bash
# Prueba las migraciones en un PostgreSQL temporal (necesita los binarios de
# PostgreSQL 16: initdb, pg_ctl y psql). Uso: scripts/test-db.sh
#  1. Aplica las migraciones anteriores al hogar y crea datos de dos cuentas.
#  2. Aplica la migración del hogar y comprueba que no se pierde nada, que cada
#     hogar ve solo lo suyo y que todas las funciones siguen funcionando.
#  3. Aplica la fase 2 (dos veces) y comprueba que las cuentas que ya existen no
#     pierden ni cambian nada: mismas filas con el mismo contenido.
#  4. En una base de datos vacía con todas las migraciones, prueba a compartir el
#     hogar: invitar, unirse, cambiar, salir (con y sin copia) y quitar a alguien.
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DIR="$(mktemp -d)"
PORT="${PG_PORT:-55433}"
run_pg() { if [ "$(id -u)" = 0 ]; then chown -R postgres "$DIR"; su postgres -c "$*"; else bash -c "$*"; fi; }
run_pg "$PG_BIN/initdb -D $DIR/data -A trust -U postgres >/dev/null && $PG_BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log start >/dev/null"
trap 'run_pg "$PG_BIN/pg_ctl -D $DIR/data stop >/dev/null"; rm -rf "$DIR"' EXIT
sleep 1
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c 'create database menu'
"${PSQL[@]}" -c 'create database menu_vacia'
EMPTY=("${PSQL[@]}" -d menu_vacia)
PSQL+=(-d menu)
"${PSQL[@]}" -f supabase/tests/stub-auth.sql
HOGAR=20261125000300_households.sql
for migration in supabase/migrations/*.sql; do
  [ "$(basename "$migration")" = "$HOGAR" ] && break
  "${PSQL[@]}" -f "$migration" >/dev/null 2>&1
done
"${PSQL[@]}" -f supabase/tests/households-before.sql >/dev/null
"${PSQL[@]}" -f "supabase/migrations/$HOGAR" >/dev/null 2>&1 || "${PSQL[@]}" -f "supabase/migrations/$HOGAR"
FASE2=20261126000100_household_sharing.sql
for migration in supabase/migrations/*.sql; do
  name="$(basename "$migration")"
  [[ "$name" > "$HOGAR" && "$name" < "$FASE2" ]] && "${PSQL[@]}" -f "$migration" >/dev/null
done
# Fase 2 sobre datos como los de producción: nada cambia. Se aplica dos veces por si
# alguien la ejecuta de nuevo en Supabase.
"${PSQL[@]}" -f supabase/tests/sharing-before.sql >/dev/null
"${PSQL[@]}" -f "supabase/migrations/$FASE2" >/dev/null
"${PSQL[@]}" -f "supabase/migrations/$FASE2" >/dev/null
"${PSQL[@]}" -At -f supabase/tests/sharing-upgrade.sql 2>&1 | grep -v '^SET$\|^RESET$\|^DO$\|^DROP TABLE$'
for migration in supabase/migrations/*.sql; do
  [[ "$(basename "$migration")" > "$FASE2" ]] && "${PSQL[@]}" -f "$migration" >/dev/null
done
"${PSQL[@]}" -At -f supabase/tests/households-after.sql 2>&1 | grep -v '^SET$\|^RESET$\|^DO$\|^GRANT$'
"${EMPTY[@]}" -f supabase/tests/stub-auth.sql
for migration in supabase/migrations/*.sql; do
  "${EMPTY[@]}" -f "$migration" >/dev/null
done
"${EMPTY[@]}" -At -f supabase/tests/household-sharing.sql 2>&1 | grep -v '^SET$\|^RESET$\|^DO$\|^GRANT$\|^CREATE\|^ALTER\|^INSERT\|^UPDATE\|^DELETE\|^$' | grep -Ev '^[0-9a-f-]{36}$|^\{\}$'
