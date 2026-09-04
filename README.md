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

- Cinco franjas diarias: desayuno, almuerzo, comida, merienda y cena.
- Varias recetas por franja.
- Productos directos por franja.
- Raciones y cantidades configurables.
- Opción `Comida fuera`.
- Navegación entre semanas.
- Escritorio: cuadrícula semanal compacta de 7 días × 5 comidas para reducir el scroll.
- Móvil: selector de los siete días y vista compacta de un único día.
- Confirmación individual del consumo de recetas y productos.
- Histórico de consumo asociado a cada entrada planificada.
- Las entradas ya consumidas quedan protegidas para evitar dobles descuentos o cambios retrospectivos.
- Una franja completada puede reabrirse para añadir nuevos consumos posteriores.
- Se puede volver a añadir la misma receta o producto en una misma franja como una nueva entrada independiente y consumirla por separado.
- Al añadir algo nuevo a una franja completada, la comida vuelve a quedar pendiente hasta completar las nuevas entradas.

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
- Los productos con cantidad `0` o estado `no tengo` no se muestran en la vista principal.
- Resumen rápido del inventario y productos con pocas existencias.
- Agrupación por categorías.
- Diseño compacto para lectura rápida tanto en escritorio como en móvil.
- Notas opcionales.
- Actualización automática al registrar consumos compatibles.

## Próximas líneas de evolución

- Ampliar cobertura de tests de lógica de negocio y operaciones de Supabase.
- Seguir automatizando el flujo Menú → Compra → Despensa → Consumo.
- Mejorar la generación y ajuste automático de la lista de compra.
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

La migración incremental `20260904000100_repeat_consumption.sql` adapta una base existente para que cada receta planificada tenga identidad propia en el histórico de consumo. Esto permite repetir una misma receta varias veces dentro de una comida sin confundir los consumos anteriores.

La migración `20260904000200_security_drift_fix.sql` alinea instalaciones existentes con la configuración de seguridad actual: las operaciones de consumo directo se ejecutan con los permisos del usuario autenticado y las funciones auxiliares fijan explícitamente su `search_path`.

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

## CI y despliegue

Los pull requests ejecutan tests y build antes de integrarse.

`.github/workflows/deploy-pages.yml` publica la aplicación en GitHub Pages cuando se actualiza `main`.

El flujo de publicación realiza:

1. Instalación de dependencias.
2. Tests.
3. Build.
4. Publicación en GitHub Pages.

Secrets necesarios en GitHub:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Las migraciones de Supabase forman parte del código versionado, pero deben estar aplicadas también en la base de datos utilizada por producción cuando incorporan cambios de esquema o funciones SQL.

## Estrategia de desarrollo

Los cambios se desarrollan en ramas `agent/*` y se integran en `main` mediante pull request. `main` representa la versión desplegable de la aplicación.
