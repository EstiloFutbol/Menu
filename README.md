# Menu

Aplicación personal para planificar el menú semanal, gestionar recetas, generar la lista de la compra y controlar la despensa.

## MVP

- Menú semanal: desayuno, almuerzo, comida, merienda y cena.
- Cada hueco puede contener una o varias recetas o marcarse como `Comida fuera`.
- Recetas con descripción, tiempo de preparación, raciones base, ingredientes, cantidades, pasos e información nutricional por ración.
- Despensa con cantidad exacta o estado (`tengo`, `queda poco`, `no tengo`).
- Lista de compra generada a partir del menú, descontando existencias cuando la cantidad de despensa sea conocida.
- Aviso de revisión cuando la existencia de un ingrediente no tenga cantidad conocida.
- Confirmación intermedia al completar una comida antes de descontar ingredientes de la despensa.
- Opción para añadir productos comprados a la despensa.

## Stack

- React
- Vite
- TypeScript
- Tailwind CSS
- Supabase (PostgreSQL + Auth + RLS)
- PWA
- GitHub Pages

## Desarrollo local

```bash
npm install
cp .env.example .env.local
npm run dev
```

Variables necesarias:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Nunca se deben subir las credenciales reales al repositorio.

## Supabase

El esquema inicial está en:

```text
supabase/schema.sql
```

Debe ejecutarse en el SQL Editor de Supabase al crear el proyecto.

## Despliegue

El workflow `.github/workflows/deploy-pages.yml` construye y publica la aplicación en GitHub Pages cuando se actualiza `main`.

Antes del despliegue hay que crear en GitHub los secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Rama de desarrollo

El desarrollo inicial se realiza en:

```text
agent/menu-mvp
```
