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
- Productos directos por franja, elegidos entre lo que hay en la despensa.
- Añadir una receta o producto a varias franjas a la vez en una sola operación; las franjas marcadas como `Comida fuera` se omiten.
- Resumen semanal desplegable.
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
- Guardado atómico: la receta, sus ingredientes y sus pasos se guardan en una sola transacción.

### Compra

- Lista de compra generada a partir de necesidades planificadas, incluidos los productos directos del menú.
- Lo que ya se ha consumido no vuelve a pedirse.
- Regenerar la lista solo sustituye los ítems generados pendientes; se conservan los añadidos a mano y los ya comprados.
- Descuento de existencias conocidas de la despensa.
- Aviso cuando un producto requiere revisión manual de despensa.
- Productos manuales con autocompletado desde el catálogo.
- Si se escribe un producto nuevo al añadirlo manualmente, se crea automáticamente en el catálogo y queda vinculado a la lista.
- Confirmación de productos comprados.
- Opción de incorporar compras a la despensa.
- Histórico de compras.
- Tienda, fecha, total, descuentos y método de pago.
- Detalle de líneas de compra, cantidades, precios y precio de referencia.
- Importación de tickets desde foto con OCR ejecutado en el navegador.
- Importación del ticket digital de Mercadona subiendo el PDF que llega por correo; el texto se extrae directamente del PDF, sin OCR.
- Creación de tickets vacíos para introducir manualmente tienda, fecha, total y líneas de producto, eligiendo cada producto del catálogo.
- Preprocesado local de la imagen (reescalado, contraste y binarización adaptativa) y OCR multipase.
- Lectores específicos para los tickets de Mercadona, Consum y Aldi; el resto de tiendas usa un lector genérico.
- Las distintas lecturas de una foto se combinan: si un precio sale dudoso, se elige la combinación que cuadra con el total del ticket.
- Aviso cuando la suma de las líneas no coincide con el total leído.
- Panel "Ver texto leído" para revisar y copiar el texto que ha reconocido el OCR.
- La imagen del ticket no se almacena ni en Supabase ni en la aplicación: se usa únicamente durante el OCR y se descarta inmediatamente después.
- Revisión obligatoria antes de guardar: tienda, fecha, total, conceptos, cantidades, unidades y precios.
- “Traducción” de conceptos abreviados del ticket a alimentos del catálogo.
- Memoria de equivalencias: las traducciones confirmadas se reutilizan en tickets posteriores.
- Selección individual de qué productos se añaden a la despensa.
- La importación registra también el ticket y sus líneas en el histórico de compras.
- Los tickets del histórico se pueden abrir y eliminar.
- El borrado de un ticket importado revierte de forma transaccional las cantidades que ese ticket añadió a la despensa.
- El borrado de una línea individual también revierte su efecto de despensa cuando existe un movimiento registrado.

### Despensa

- Productos vinculados al catálogo de ingredientes.
- Control por cantidad exacta y unidad.
- Control alternativo por estado: `tengo`, `queda poco` o `no tengo`.
- Los productos con cantidad `0` o estado `no tengo` no se muestran en la vista principal.
- Resumen rápido del inventario y productos con pocas existencias.
- Agrupación por categorías.
- Diseño compacto para lectura rápida tanto en escritorio como en móvil.
- Vista interna de catálogo con todos los productos creados, aunque no tengan existencias.
- Búsqueda por nombre, categoría o unidad habitual.
- Creación y edición de productos desde Despensa.
- Eliminación segura de productos no utilizados; si ya forman parte de recetas, menú, compras o consumos, se conserva el producto para proteger el histórico.
- Notas opcionales.
- Actualización automática al registrar consumos compatibles.

### Campos numéricos

Todos los campos numéricos aceptan coma o punto decimal y limitan los decimales según su tipo: cantidades y dinero con 2, nutrición con 1, y raciones, minutos y envases como enteros. La base de datos guarda los valores con esa misma precisión.

## Próximas líneas de evolución

- Ampliar la cobertura de tests a las operaciones de Supabase y a los componentes.
- Seguir automatizando el flujo Menú → Compra → Despensa → Consumo.
- Mejorar la generación y ajuste automático de la lista de compra.
- Seguir ampliando el reconocimiento de formatos de ticket y sugerencias de equivalencias a partir de tickets reales.
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
- Tesseract.js para OCR local de tickets
- pdf.js para leer los tickets en PDF
- GitHub Actions y Dependabot

## Estructura principal

```text
src/
  components/        UI y flujos principales
  lib/               cliente Supabase y lógica compartida
    domain.ts          unidades, semanas, necesidades de compra y despensa
    numbers.ts         reglas de los campos numéricos
    errors.ts          mensajes de error comprensibles
    receipt.ts         lector genérico de tickets
    mercadona.ts       ticket de Mercadona (PDF y foto)
    store-receipts.ts  tickets de Consum y Aldi
    receipt-merge.ts   combinación de varias lecturas OCR
    receipt-image.ts   preprocesado de la imagen
    receipt-pdf.ts     extracción del texto de un PDF
    __fixtures__/      textos OCR reales usados en los tests
scripts/
  copy-ocr-assets.mjs  copia los ficheros del OCR a public/ocr
supabase/
  migrations/        fuente de verdad del esquema de base de datos
.github/
  workflows/         CI y despliegue
  dependabot.yml     actualizaciones automáticas de dependencias
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

La migración `20260918000100_receipt_import.sql` añade las equivalencias de conceptos de ticket y la operación transaccional de importación revisada. No existe ningún campo de base de datos destinado a imágenes de tickets. La foto solo se utiliza como entrada temporal del OCR en el navegador; al terminar se descarta y únicamente se guardan los datos estructurados que el usuario confirma.

La migración `20260918000200_reversible_ticket_delete.sql` registra el efecto real de cada línea importada sobre la despensa y añade operaciones transaccionales para borrar líneas o tickets completos revirtiendo primero ese efecto. Los tickets importados antes de esta migración no tienen metadatos suficientes para reconstruir con seguridad un movimiento de despensa pasado, por lo que solo se revierten automáticamente los movimientos registrados a partir de esta versión.

La migración `20260922000100_safe_product_delete.sql` añade el borrado seguro del catálogo de productos. Solo permite eliminar definitivamente productos que no estén referenciados por recetas, planificación, compras o consumos; antes de borrar elimina su posible fila de despensa y equivalencias de ticket.

La migración `20261012000100_add_to_menu_slots.sql` añade la operación que inserta recetas y productos en varias franjas del menú en una sola transacción. Crea las franjas que no existen, conserva lo que ya hay en cada una y omite las marcadas como `Comida fuera`.

La migración `20261012000200_shopping_regenerate.sql` distingue los ítems de la lista generados desde el menú de los añadidos a mano. Así, regenerar la lista solo sustituye los generados pendientes.

La migración `20261012000300_atomic_saves.sql` añade `save_recipe` y `save_menu_slot`, que guardan una receta o una franja completa en una sola transacción: o se guarda todo o no se guarda nada.

La migración `20261012000400_numeric_precision.sql` ajusta la precisión de las columnas numéricas: cantidades y dinero con 2 decimales, precio de referencia (€/kg, €/l) con 2, nutrición con 1 y envases enteros. Redondea los datos existentes.

La migración `20261012000500_security_hardening.sql` refuerza el aislamiento entre usuarios. Las políticas exigen que cualquier fila referenciada (ingrediente, receta, entrada del menú) pertenezca al mismo usuario. Además, las funciones SQL solo pueden ejecutarlas usuarios con sesión iniciada.

## Desarrollo local

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Antes de `dev` y de `build` se ejecuta `scripts/copy-ocr-assets.mjs`. El script copia a `public/ocr/` el worker de Tesseract, el motor WebAssembly y el modelo de español, que vienen del paquete `@tesseract.js-data/spa`. Así la app los sirve desde su propio dominio. La carpeta se genera en cada build y no se versiona. Estos ficheros pesan unos 10 MB y no entran en la caché offline de la PWA: se descargan al leer el primer ticket.

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

Los tests (38 casos) cubren la lógica que no depende de la interfaz:

- Dominio: conversión de unidades, visibilidad de la despensa, semanas, suma de necesidades, comparación con la despensa y escalado de recetas.
- Campos numéricos: entrada con coma o punto, decimales, rangos y redondeo.
- Mensajes de error de Supabase traducidos a texto comprensible.
- Tickets: lector genérico, PDF y foto de Mercadona, Consum, Aldi, combinación de lecturas y fechas.

Los tests de tickets usan textos OCR reales guardados en `src/lib/__fixtures__/`. Cuando un ticket nuevo se lee mal, conviene añadir su texto como fixture y un test que lo cubra.

Las funciones SQL no tienen tests automáticos. Se prueban en un Postgres local antes de cada migración.

## Build

```bash
npm run build
```

El build copia los ficheros del OCR, ejecuta TypeScript y genera la aplicación de producción con Vite. El `index.html` generado incluye una política de seguridad de contenido (CSP). Esa política solo permite ejecutar código de la propia app y conectarse a ella misma y al proyecto de Supabase indicado en `VITE_SUPABASE_URL`. La CSP no se aplica en `npm run dev`.

## CI y despliegue

Los pull requests ejecutan tests y build antes de integrarse.

`.github/workflows/deploy-pages.yml` publica la aplicación en GitHub Pages cuando se actualiza `main`.

El flujo de publicación realiza:

1. Instalación de dependencias con `npm ci`, usando las versiones exactas de `package-lock.json`.
2. Tests.
3. Build.
4. Publicación en GitHub Pages.

Secrets necesarios en GitHub:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Las migraciones de Supabase forman parte del código versionado, pero deben estar aplicadas también en la base de datos utilizada por producción cuando incorporan cambios de esquema o funciones SQL.

Dependabot propone cada semana actualizaciones de npm y cada mes actualizaciones de las GitHub Actions.

## Seguridad

- Cada tabla tiene Row Level Security por `user_id`. Las referencias entre tablas también se comprueban, de modo que nadie puede enlazar sus filas con datos de otro usuario.
- Las funciones SQL se ejecutan con los permisos del usuario (`security invoker`), fijan su `search_path` y comprueban `auth.uid()`. Solo el rol `authenticated` puede ejecutarlas.
- La app solo usa la clave publicable de Supabase. Nunca se debe usar la clave de servicio en el frontend.
- El registro público de usuarios debe estar desactivado en Supabase (Authentication → Sign In / Providers → "Allow new users to sign up").
- Las imágenes y los PDF de los tickets solo se procesan en el navegador y no se guardan en ningún sitio.
- La CSP y el OCR servido desde el propio dominio evitan cargar código de terceros en tiempo de ejecución.

## Estrategia de desarrollo

Los cambios se desarrollan en ramas de trabajo y se integran en `main` mediante pull request. `main` representa la versión desplegable de la aplicación.
