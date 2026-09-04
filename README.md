# Menu

Aplicación personal para planificar la alimentación semanal, gestionar recetas, controlar la compra y mantener una despensa útil y conectada con el consumo real.

## Estado actual

El proyecto ya supera el MVP inicial y está organizado en cuatro áreas principales:

- **Menú**: planificación semanal con desayuno, almuerzo, comida, merienda y cena.
- **Recetas**: recetas con raciones, ingredientes, cantidades, pasos e información nutricional.
- **Compra**: lista de compra y registro/histórico de compras y precios.
- **Despensa**: inventario con cantidad exacta o estado rápido.

La aplicación permite combinar varias recetas en una comida, añadir productos directos sin necesidad de convertirlos en receta, marcar comidas fuera y registrar el consumo real.

## Flujo funcional

El objetivo del producto es conectar estas cuatro áreas:

1. Se planifica la semana en el menú.
2. Las recetas y productos planificados determinan las necesidades de compra.
3. La despensa permite descontar existencias conocidas.
4. Al completar una receta o producto se confirma el consumo real.
5. El consumo descuenta automáticamente de la despensa cuando las unidades son compatibles.
6. Las compras pueden incorporarse a la despensa y conservarse en un histórico de precios.

## Funcionalidades actuales

### Menú

- Vista semanal.
- Cinco franjas diarias: desayuno, almuerzo, comida, merienda y cena.
- Varias recetas por franja.
- Productos directos por franja.
- Raciones y cantidades configurables.
- Opción `Comida fuera`.
- Navegación entre semanas.
- Confirmación individual del consumo de recetas y productos.
- Histórico de consumo asociado a la planificación.

### Recetas

- Nombre y descripción.
- Tiempo de preparación.
- Raciones base.
- Ingredientes, cantidades, unidades y notas.
- Pasos de preparación.
- Información nutricional por ración: calorías, proteína, hidratos, fibra, grasa y azúcar.

### Compra

- Lista de compra generada a partir de necesidades planificadas.
- Descuento de existencias conocidas de la despensa.
- Aviso cuando un producto requiere revisión manual de despensa.
- Productos manuales.
- Confirmación de productos comprados.
- Opción de incorporar compras a la despensa.
- Histórico de compras.
- Tienda, fecha, total, descuentos y método de pago.
- Detalle de líneas de compra, cantidades, precios y precio de referencia.

### Despensa

- Productos vinculados al catálogo de ingredientes.
- Control por cantidad exacta y unidad.
- Control alternativo por estado: `tengo`, `queda poco` o `no tengo`.
- Notas opcionales.
- Actualización automática al registrar consumos compatibles.

## Próximas líneas de evolución

- Mejorar la visualización semanal del menú en escritorio y móvil.
- Mejorar la lectura rápida de la despensa y ocultar productos sin existencias.
- Ampliar cobertura de tests de lógica de negocio y operaciones de Supabase.
- Generación y ajuste más automático de la lista de compra.
- Futuro: lectura de tickets mediante imagen para registrar compras automáticamente.
- Futuro: sugerencias de menú y recetas según despensa, preferencias, coste y nutrición.

## Stack

- React 19
- Vite 7
- TypeScript 5.9
- Tailwind CSS 4
- Supabase: PostgreSQL + Auth + RLS + funciones SQL
- PWA
- GitHub Pages
- Vitest
- GitHub Actions

## Estructura principal

```text
src/
  components/        UI y flujos principales
  lib/               cliente Supabase y lógica compartida
supabase/
  migrations/        fuente de verdad del esquema de base de datos
.github/workflows/   CI y despliegue
```

## Base de datos

La base de datos se gestiona exclusivamente mediante migraciones en:

```text
supabase/migrations/
```

Las migraciones deben ser suficientes para crear un proyecto Supabase vacío desde cero. No se mantiene un `schema.sql` paralelo como segunda fuente de verdad.

Las tablas usan Row Level Security para aislar los datos de cada usuario.

## Desarrollo local

```bash
npm install
cp .env.example .env.local
npm run dev
```

Variables necesarias:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Nunca se deben subir credenciales reales al repositorio.

## Tests

Ejecutar la suite completa:

```bash
npm test
```

Modo interactivo durante desarrollo:

```bash
npm run test:watch
```

Los tests cubren inicialmente lógica de dominio sensible: conversiones de unidades, reglas de visibilidad de despensa y cálculo de semanas. La cobertura se ampliará conforme se extraiga lógica de negocio de los componentes.

## Build

```bash
npm run build
```

El build ejecuta TypeScript y genera la aplicación de producción con Vite.

## Despliegue

`.github/workflows/deploy-pages.yml` publica la aplicación en GitHub Pages cuando se actualiza `main`.

El workflow realiza:

1. Instalación de dependencias.
2. Tests.
3. Build.
4. Publicación en GitHub Pages.

Secrets necesarios en GitHub:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

## Estrategia de desarrollo

Los cambios se desarrollan en ramas `agent/*` y se integran en `main` mediante pull request. `main` representa la versión desplegable de la aplicación.
