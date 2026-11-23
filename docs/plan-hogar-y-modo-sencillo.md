# Plan: modo hogar (familiar) y modo sencillo

Estado: **fases 1 y 2 hechas** (versiones 0.5.9 y 0.6.0). Quedan la fase 3 (modo sencillo) y la 4 (cambios en vivo).

Diferencias con lo previsto al hacer la fase 2:
- Las invitaciones a un hogar reutilizan `app_invites` (`kind = 'household'` y `household_id`), no una tabla `household_invites` aparte.
- No se crean hogares nuevos: para compartir, el responsable invita a su hogar personal. Quien se une puede salir; el dueño del hogar personal no.
- La copia al salir incluye también las traducciones de tickets. Las compras copiadas no tocan la despensa.
- Al volver a la app tras más de un minuto fuera, las secciones abiertas se recargan si no hay cambios sin guardar. No hay botón de recargar: también se recarga al abrir cada sección.

## Decisiones tomadas

| Pregunta | Decisión |
|---|---|
| ¿Cómo acceden las personas del hogar? | **Hogar con cuentas.** Cada persona entra con su cuenta y se une al hogar con una invitación. |
| ¿Qué se comparte? | **Todo**: despensa, menú, lista de la compra, recetas, productos, tickets e historial. |
| ¿Cómo se elige sencillo o completo? | **Un interruptor para toda la app**, en Ajustes. |
| ¿Cómo se escribe el menú en modo sencillo? | **Un texto por día.** |
| ¿Cómo consiguen cuenta los invitados? | **«Crear cuenta» en la app, solo con un código de invitación.** Tú puedes seguir creando cuentas en Supabase. |
| ¿El modo es de cada persona o del hogar? | **Del hogar**: todos ven la app en el mismo modo. |
| ¿Qué versión marca que ya se puede compartir? | **0.6.0**, al terminar la fase 2. |

## Garantía principal: nunca se pierde información

Es un requisito del propietario y manda sobre el resto del diseño.

**Al cambiar de hogar, unirse o salir**
- **Nada se borra nunca** de la base de datos por unirse, cambiar o salir de un hogar.
- Se distinguen dos acciones:
  - **Cambiar de hogar**: solo cambia qué hogar ves. Sigues siendo miembro de todos y puedes volver cuando quieras.
  - **Salir del hogar**: dejas de ser miembro. Lo que añadiste se queda en ese hogar para los demás (es de todos: la despensa de esa casa, sus recetas…).
- **Al salir, puedes llevarte una copia** a tu hogar personal: tus recetas, los productos del catálogo que usan y tu historial de tickets y compras. Se ofrece siempre antes de confirmar la salida.
- **El hogar personal no se pierde nunca**: no se puede salir de él ni borrarlo, y sus datos no se tocan al unirte a otros hogares.
- **Quitar a alguien** (el responsable) equivale a que esa persona salga: no se borra nada y conserva su hogar personal.
- **No hay «borrar hogar»** en esta versión. Un hogar compartido sin miembros se conserva tal cual.

**Al cambiar entre sencillo y completo**
- Los dos modos guardan sus datos **por separado** y el interruptor **solo cambia qué se muestra**. Se puede ir y volver cuantas veces se quiera sin perder nada.
- **En sencillo** se sigue viendo lo del completo:
  - debajo del texto de cada día, en pequeño y sin poder editarlo, lo que hay planificado en el menú completo («En el menú completo: lentejas, yogur»);
  - en Compra, lo que hay en la lista completa.
- **En completo** se sigue viendo lo del sencillo: la nota de cada día en el menú y la lista sencilla como «Apuntado a mano».
- Ningún cambio de modo modifica datos. Hay un test que cambia de modo varias veces y comprueba que todo sigue igual.

## En resumen (para quien usa la app)

**Hogar**
- En **Ajustes → Hogar** cada cuenta ve su hogar: el nombre, quién está y un botón **«Invitar»**.
- **Invitar** genera un código corto (por ejemplo `K7M-Q2PX`), que caduca a los 7 días y sirve para una persona.
- La otra persona:
  - **si no tiene cuenta**: en la pantalla de entrada pulsa **«Crear cuenta con invitación»** y escribe el código, su correo y una contraseña. Entra directamente en el hogar;
  - **si ya tiene cuenta**: va a **Ajustes → Hogar → «Unirme a un hogar»** y escribe el código.
- Desde ese momento los dos ven y editan **lo mismo**: si uno marca algo como comprado o consume una receta, el otro lo ve.
- Quien crea el hogar es su **responsable**: puede invitar, quitar personas y cambiarle el nombre. Cualquiera puede **salir** del hogar.
- Al unirse a otro hogar no se pierde nada: los datos de cada uno siguen en su **hogar personal**. Con **«Cambiar de hogar»** se pasa de uno a otro, y al **salir** de un hogar se ofrece llevarse una copia de sus recetas y su historial.

**Modo sencillo**
- En **Ajustes** se elige **Sencillo** o **Completo**. El modo es del hogar: todos ven la app igual.
- En **sencillo**, la app tiene solo tres secciones:
  - **Menú**: la semana con un cuadro de texto por día («Lunes: lentejas y fruta; cena: tortilla»). Se guarda solo mientras escribes y se puede cambiar de semana y copiar la semana a la siguiente.
  - **Compra**: una lista escrita por ti, una cosa por línea, con casilla para marcar lo comprado. Puedes pegar varias líneas de golpe y **«Quitar lo comprado»** limpia la lista.
  - **Ajustes**.
- Se puede cambiar de modo cuantas veces se quiera y **no se pierde nada**:
  - en completo, los textos del menú se ven como **nota de cada día** y la lista sencilla aparece en Compra como **«Apuntado a mano»**;
  - en sencillo se ve, sin poder editarlo, lo que hay en el menú y la lista del modo completo.

## Cómo está hoy (punto de partida)

- Cada dato pertenece a **un usuario** (`user_id`). La seguridad de Supabase (RLS) solo deja ver las filas con `user_id = auth.uid()`.
- **9 tablas** guardan el dueño: `ingredients`, `recipes`, `menu_entries`, `pantry_items`, `shopping_lists`, `purchases`, `consumption_logs`, `receipt_aliases` y `user_settings`. El resto (pasos de receta, filas del menú, líneas de ticket…) cuelga de ellas.
- **16 funciones SQL** comprueban el dueño con `auth.uid()`:
  - `add_basic_ingredients`, `add_to_menu_slots`, `complete_planned_product`, `complete_planned_recipe`, `copy_menu_week`;
  - `delete_purchase_and_reverse_pantry`, `delete_purchase_item_and_reverse_pantry`, `delete_unused_ingredient`;
  - `import_reviewed_receipt`, `merge_ingredients`, `refresh_menu_entry_completion`, `regenerate_shopping_list`;
  - `reverse_purchase_item_pantry_effect`, `save_menu_slot`, `save_recipe`, `undo_consumption`.
- La app no tiene pantalla de registro: las cuentas se crean en Supabase. Por eso el registro público está, en la práctica, cerrado, y así debe seguir: solo se podrá crear cuenta con un código válido.

## Diseño técnico

### Hogar

**Tablas nuevas**
- `households`: `id`, `name`, `created_by`, `created_at`.
- `household_members`: `household_id`, `user_id`, `role` (`owner` | `member`), `joined_at`. Clave `(household_id, user_id)`.
- `household_invites`: `code` (8 caracteres sin ambiguos: sin 0/O ni 1/I), `household_id`, `created_by`, `expires_at`, `used_by`, `used_at`.
- `household_settings`: las preferencias que hoy están en `user_settings` y afectan a todos (raciones por defecto, inicio de semana, comidas visibles) más el nuevo `mode` (`sencillo` | `completo`).
- `user_settings` se queda con lo personal: el **hogar activo** (`active_household_id`). Cambiar de hogar solo cambia este valor.

**El «hogar actual»**
- `current_household_id()` devuelve el hogar activo del usuario si sigue siendo miembro; si no, su hogar personal.
- Es la pieza central: las políticas y funciones dejan de mirar `auth.uid()` y miran el hogar.

**Las 8 tablas de datos**
- Columna nueva `household_id not null default current_household_id()`. Se rellena a partir de `user_id`, porque cada usuario tiene ya su hogar personal.
- `user_id` se mantiene como **«quién lo hizo»** (autor del ticket, del consumo…). Sirve para mostrar «Lo compró Ana».
- Las restricciones únicas pasan de `user_id` a `household_id`:
  - productos por nombre;
  - una fila de despensa por producto;
  - una entrada de menú por día y comida;
  - una lista por semana;
  - una traducción de ticket por nombre.
- Las políticas RLS pasan a `household_id = current_household_id()`. Las tablas hijas comprueban el hogar de su tabla padre, igual que hoy comprueban el usuario.

**Las 16 funciones**
- Se reescriben cambiando el filtro de usuario por el de hogar.
- Las firmas no cambian, así que **la app apenas cambia**: los `insert` que hoy envían `user_id` siguen funcionando, porque el hogar se rellena solo.

**Cuentas nuevas**
- El trigger de alta crea el hogar personal («Hogar de ana@…»), la membresía como responsable y los productos básicos del hogar.

**Funciones de gestión**
- `create_household_invite()`, `join_household(code)`, `switch_household(id)`, `leave_household(copy_to_personal boolean)`, `remove_member(user_id)` y `rename_household(name)`.
- Ninguna de ellas borra datos: solo cambian membresías o el hogar activo.
- `leave_household(true)` copia a tu hogar personal tus recetas (con sus pasos), los productos que usan (sin duplicar los que ya tienes, con la lógica de `merge_ingredients`) y tus compras con sus líneas.
- No se puede salir del hogar personal.
- Todas en una transacción y comprobando el rol.

**Crear cuenta con código de invitación**
- La pantalla de entrada (`AuthGate`) tiene un enlace **«Crear cuenta con invitación»**: código, correo y contraseña (con las mismas reglas que «Cambiar contraseña»).
- La app llama a `supabase.auth.signUp` enviando el código en los datos del usuario (`options.data.invite_code`).
- **La comprobación del código es en la base de datos, no en la app.** Con la clave pública cualquiera podría llamar al registro de Supabase saltándose la app. Hay dos formas, que se probarán en Supabase en este orden:
  1. **Auth hook «Before User Created»** de Supabase: una función SQL que rechaza el alta si el código no existe, ha caducado o ya se usó. Es la forma prevista por Supabase para esto.
  2. Si el plan gratuito no lo permite: un **trigger `before insert` en `auth.users`** con la misma comprobación. Hay que confirmar que deja seguir creando cuentas desde el panel de Supabase (por ejemplo, permitiendo las altas sin código solo desde el panel).
- Tras el alta, el trigger que ya crea el hogar personal y los productos básicos también **une la cuenta al hogar del código**, lo deja como hogar activo y marca el código como usado.
- **Confirmación del correo**: si en Supabase está activada, el invitado recibe un correo para confirmar antes de entrar. Se mantiene activada, y la app lo explica tras el registro («Te hemos enviado un correo para confirmar la cuenta»).
- **Los intentos con códigos inválidos no crean nada.** El código tiene 8 caracteres de un alfabeto de 31, unos 850 000 millones de combinaciones, caduca a los 7 días y sirve una vez. Adivinarlo no es práctico.

**Al unirse a un hogar**
- Se cambia el hogar activo. Los datos propios quedan intactos en el hogar personal.
- Más adelante, si hace falta, lo contrario: «Llevar mis recetas al hogar compartido», con la misma copia sin duplicados.

### Modo sencillo

**Tablas nuevas** (las dos con `household_id`, RLS por hogar y autor `user_id`)
- `menu_day_notes`: `household_id`, `day` (fecha), `text`, `updated_by`, `updated_at`. Única por `(household_id, day)`.
- `quick_list_items`: `household_id`, `text`, `checked`, `position`, `created_by`.

**Interruptor**: `household_settings.mode`. `App.tsx` elige qué secciones mostrar según el modo.

**Pantallas nuevas**
- `SimpleMenuSection`: navegación de semana (la misma de hoy), 7 cuadros de texto con guardado automático (unos 600 ms después de dejar de escribir) y «Copiar semana».
- `SimpleShoppingSection`:
  - campo para añadir; pegar varias líneas crea varias cosas;
  - casillas para marcar;
  - mover de orden;
  - «Quitar lo comprado».

**Cada modo muestra lo del otro** (nada se oculta del todo)
- **En completo**: la nota del día aparece encima del día en el menú (editable), y los apuntes sencillos aparecen como bloque en Lista de la compra (se pueden marcar).
- **En sencillo**: debajo de cada día, en pequeño y sin poder editarlo, lo planificado en el menú completo; y en Compra, lo que hay en la lista completa.
- El interruptor solo cambia `household_settings.mode`. No toca ninguna otra tabla.

### Ver los cambios de los demás

Con un hogar compartido, la lista y el menú tienen que actualizarse cuando otro los cambia:
- **Fase base**: recargar al volver a la app o a la pestaña (`visibilitychange`), al abrir cada sección y con un botón de recargar.
- **Después**: Supabase Realtime en la lista de la compra, el menú y la despensa, para verlo al instante.

## Plan por fases

Cada fase es una PR, o un par de ellas, con su migración probada en PostgreSQL local con varios usuarios y hogares, sus tests y su versión.

| Fase | Qué incluye | Qué ve el usuario |
|---|---|---|
| **1. Base del hogar** | Tablas de hogar. `household_id` en las 8 tablas. Políticas y 16 funciones por hogar. Hogar personal para las 3 cuentas actuales. Ajustes de planificación pasan al hogar. | Nada cambia. Es la más delicada: toca todas las tablas. |
| **2. Invitar y gestionar** (versión **0.6.0**) | Ajustes → Hogar: nombre, miembros, invitar con código, unirse, cambiar de hogar, salir (con copia) y quitar a alguien. **«Crear cuenta con invitación»** en la pantalla de entrada. Recarga al volver a la app. | Ya se puede compartir todo con otra cuenta, y los invitados se crean la cuenta solos. |
| **3. Modo sencillo** | Tablas de notas del día y lista sencilla, interruptor en Ajustes, pantallas de menú y compra sencillos, y cómo se ven en modo completo. | El modo sencillo completo. |
| **4. En vivo y autoría** | Supabase Realtime en lista, menú y despensa. «Lo hizo Ana» en tickets y consumos. | Los cambios del otro aparecen al momento. |

Recomiendo este orden. El modo sencillo se apoya en el hogar desde el principio (sus tablas nacen con `household_id`), así no hay que migrarlo después.

El modo sencillo **también podría ir primero**, porque es más corto y no toca lo existente. Pero entonces sus dos tablas tendrían que pasar después por la migración del hogar.

## Cómo se prueba

- **Base de datos**: todas las migraciones aplicadas en PostgreSQL 16 local con varias cuentas.
  - Lo de un hogar **no se ve ni se toca** desde otro: lectura, escritura y cada una de las funciones.
  - Dos miembros del mismo hogar ven y cambian lo mismo.
  - Un código caducado o ya usado no sirve.
  - Al salir del hogar se vuelve al personal con los datos intactos.
  - **Nada se borra**: se cuentan las filas de todas las tablas antes y después de unirse, cambiar, salir (con y sin copia) y quitar a alguien. Ninguna baja; solo suben las copias al salir con copia.
  - **Cambiar de modo no toca datos**: se cambia de sencillo a completo y al revés varias veces y se comprueba que todas las tablas quedan idénticas.
- **App**: tests de la lógica nueva y pruebas en navegador con Playwright (móvil y ordenador) de cada pantalla.
- **Antes de la fase 1 en Supabase**: descargar la copia de seguridad (Ajustes → Copia de seguridad) de cada cuenta.

## Riesgos

- **La fase 1 toca la seguridad de todos los datos.** Un error en una política podría mostrar datos de otro hogar. Por eso cada tabla y función tendrá su prueba de aislamiento antes de subirla.
- **Productos y recetas duplicados** si en el futuro se juntan los datos de dos personas: se resolverá con la fusión de productos que ya existe.
- **Registro abierto por error**: si la comprobación del código fallara, cualquiera podría crearse una cuenta. Por eso la comprobación está en la base de datos y tendrá pruebas de que sin código válido no se crea nada.

## Pendiente de comprobar al implementar

- En Supabase: si el hook «Before User Created» está disponible en el plan del proyecto, o hay que usar el trigger. Y que, en ese caso, se siguen pudiendo crear cuentas desde el panel.
- Si la confirmación de correo está activada en el proyecto «Menu», y el texto del correo.
