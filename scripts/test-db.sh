#!/usr/bin/env bash
# Prueba las migraciones en un PostgreSQL temporal (necesita los binarios de
# PostgreSQL 16: initdb, pg_ctl y psql). Uso: scripts/test-db.sh
#  1. Aplica las migraciones anteriores al hogar y crea datos de dos cuentas.
#  2. Aplica la migración del hogar y comprueba que no se pierde nada, que cada
#     hogar ve solo lo suyo y que todas las funciones siguen funcionando.
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DIR="$(mktemp -d)"
PORT="${PG_PORT:-55433}"
run_pg() { if [ "$(id -u)" = 0 ]; then chown -R postgres "$DIR"; su postgres -c "$*"; else bash -c "$*"; fi; }
run_pg "$PG_BIN/initdb -D $DIR/data -A trust -U postgres >/dev/null && $PG_BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log start >/dev/null"
trap 'run_pg "$PG_BIN/pg_ctl -D $DIR/data stop >/dev/null"; rm -rf "$DIR"' EXIT
sleep 1
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c 'create database menu'
PSQL+=(-d menu)
"${PSQL[@]}" -f supabase/tests/stub-auth.sql
HOGAR=20261125000300_households.sql
for migration in supabase/migrations/*.sql; do
  [ "$(basename "$migration")" = "$HOGAR" ] && break
  "${PSQL[@]}" -f "$migration" >/dev/null 2>&1
done
"${PSQL[@]}" -f supabase/tests/households-before.sql >/dev/null
"${PSQL[@]}" -f "supabase/migrations/$HOGAR" >/dev/null 2>&1 || "${PSQL[@]}" -f "supabase/migrations/$HOGAR"
for migration in supabase/migrations/*.sql; do
  [[ "$(basename "$migration")" > "$HOGAR" ]] && "${PSQL[@]}" -f "$migration" >/dev/null
done
"${PSQL[@]}" -At -f supabase/tests/households-after.sql 2>&1 | grep -v '^SET$\|^RESET$\|^DO$\|^GRANT$'
