# E6 Mini-CRM — Guía de pruebas y pendientes

Guía para verificar el módulo cuando exista una **base de pruebas** (un proyecto de Supabase que no sea el DEV compartido). Hasta entonces, ninguna casilla de la sección 14 de la especificación (`docs/crm/ESPECIFICACION_CRM_E6.md`) está verificada: las cinco entregas pasaron `tsc`, lint y build, pero nunca se ejecutaron contra las tablas.

> Regla del módulo: el código nunca ejecuta SQL. Las migraciones las aplica una persona autorizada, y solo en la base de pruebas.

---

## 1. Orden para aplicar las migraciones

Sobre un proyecto Supabase **nuevo** (o uno de pruebas que no sea el compartido):

| Orden | Archivo | Qué hace | Notas |
|---|---|---|---|
| 0 | `supabase/migrations/20261009120000_m1_esquema_base.sql`, `…120100_m2_seguridad.sql`, `…120200_m3_realtime_storage.sql` | Esquema base del sitio (citas, consultas, etc.) | Ya existentes |
| 0 | `docs/sql/push_subscriptions.sql` y los `docs/sql/sql-configuracion-*.sql` | Notificaciones push y claves de `configuracion` | Ya existentes |
| 1 | **Catálogo E5** (`areas_practica` y `servicios`) | Áreas y servicios activos | **No está en este repositorio**: lo entrega el módulo E5. M4 tiene claves foráneas a estas tablas y no se aplica sin ellas |
| 2 | `docs/sql/20261112120000_m4_crm.sql` | 17 tablas `crm_*`, vista `crm_v_carga_personal`, triggers y funciones | Aborta si falta el catálogo |
| 3 | `docs/sql/20261112120100_m5_crm_citas.sql` | Cambios a `public.citas` (abogado, duración, sin cruces, `crm_cancelar_cita`) | Aborta si M4 no está o si hay citas activas repetidas en la misma fecha y hora |

Comprobaciones tras aplicar:

1. `select count(*) from crm_personal;` responde (la tabla existe).
2. `select * from crm_v_carga_personal;` responde sin error.
3. `select column_name from information_schema.columns where table_name = 'citas' and column_name in ('abogado_id','solicitud_id','duracion_min');` devuelve 3 filas.
4. Opcional, en un **Postgres local** (nunca en Supabase): `docs/crm/pruebas_reglas_crm.sql` debe terminar con `FALLOS 0` (132 pruebas de las reglas de la base).

Variables de entorno de la aplicación apuntando a la base de pruebas: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, y para correos `RESEND_API_KEY` + `RESEND_FROM_EMAIL`. En Supabase Auth: envío de correos y URL de redirección configurados (los usa la invitación).

---

## 2. Usuarios de prueba

Crear las cuentas en Supabase Auth (correo + contraseña de prueba, **nunca** las de personas reales) y luego sus fichas desde `/admin/crm/usuarios` entrando como Dirección. La primera cuenta es la del `ADMIN_EMAIL`: entra a `/admin/login` y recibe su ficha de Dirección automáticamente.

| Usuario | Rol | Ficha | Para qué |
|---|---|---|---|
| `direccion@prueba.test` | Dirección | Es abogada, matrícula, habilitación verificada | Todo; aprobar, reasignar, horarios |
| `coordinacion@prueba.test` | Coordinación | No es abogada | Casi todo menos aprobar; no debe ver reservados |
| `asistencia@prueba.test` | Asistencia | No es abogada | Captación y citas; sin notas jurídicas |
| `asociado1@prueba.test` | Asociado | Abogado, matrícula, habilitación verificada, **capacidad 1** | Titular; prueba del límite de capacidad |
| `asociado2@prueba.test` | Asociado | Abogado, habilitación verificada, capacidad 5 | Suplente; no ve el caso hasta activarse |
| `externo@prueba.test` | Externo | Perito, acuerdo de confidencialidad firmado | Vista reducida |

Datos para las pruebas:

- **Catálogo:** al menos 2 áreas y 2 servicios activos por área.
- **Áreas de referencia** (`/admin/crm/personal/[id]` → áreas): titular `asociado1` y suplente `asociado2` en un área.
- **Horario:** como Dirección, una franja lunes–viernes 09:00–13:00 y 14:00–18:00 para `asociado1`.
- **Caso reservado:** una solicitud con **reserva reforzada** creada por Dirección (`/admin/crm/solicitudes/nueva`, marcar reserva) cuyo equipo activo incluya solo a `asociado2`. Debe ser invisible para coordinación, asistencia, `asociado1` y externo; visible para Dirección (queda `ver_reservado` en el Historial) y `asociado2`.
- **Feriado:** una fecha futura en `configuracion.festivos` = `{ "fechas": ["AAAA-MM-DD"] }`.
- **Un caso de cada fase:** `nueva`, `en_calificacion`, `consulta_agendada`, `asignada`, `en_curso` y `cerrada`, para que el tablero y los reportes tengan datos.

---

## 3. Lista de la sección 14 con pasos concretos

Marcar cada casilla al comprobarla. «API» = comprobar la respuesta de la ruta (herramienta del navegador → Red, o `curl` con la cookie de sesión), no solo la pantalla.

### Entrega 1 — Cimientos

- [ ] **Asociado: menú y acceso.** Entrar como `asociado1`. En el menú de usuario del sitio público aparece «CRM» y no «Panel Admin» ni «Modo edición». Abrir `/admin/crm` (carga). Abrir `/admin/blog` → lo rechaza (redirige).
- [ ] **Crear un usuario de asistencia.** Como Dirección: `/admin/crm/usuarios/nuevo`, rol asistencia. Llega la invitación por correo; el usuario define su contraseña, entra y su menú solo trae sus secciones (Tablero, Solicitudes, Contactos, Validación, Duplicados, Agenda, Tareas, Avisos; sin Personal, Usuarios ni Historial).
- [ ] **Desactivar corta el acceso.** Con la sesión de `asistencia` abierta, Dirección la desactiva. La siguiente petición de `asistencia` (recargar cualquier página o llamar a `/api/admin/crm/yo`) devuelve 403 / pantalla «Sin acceso al CRM».
- [ ] **Protecciones.** Dirección intenta desactivarse a sí misma → rechazado. Intenta cambiar su propio rol → rechazado. Con una sola Dirección activa, otra persona no puede degradarla (R-55: error `CRM-R55` traducido a 422).
- [ ] **Historial.** En `/admin/crm/bitacora` aparecen: crear usuario, cambio de rol, desactivar y reactivar, cada uno con quién y cuándo.

### Entrega 2 — Captación

- [ ] **Cédula y RUC.** Crear un contacto con cédula inválida → error junto al campo. Con un RUC cuyo dígito verificador no cuadra → se guarda y la ficha dice «no validado».
- [ ] **Duplicados al crear.** Crear un contacto con un correo que ya existe → antes de guardar se muestra la coincidencia; al confirmar, aparece un par en `/admin/crm/duplicados`.
- [ ] **Fusionar.** En un par, elegir la ficha que se conserva y fusionar. Las solicitudes y actividades de la otra pasan a la conservada; la otra queda como «fusionada» y no se edita ni recibe solicitudes.
- [ ] **Formulario web.** Enviar `/contacto` y `/agenda` (con un cuerpo válido): se crean contacto y solicitud `nueva` con código `S26-xxxx`. Reenviar la misma consulta no duplica la solicitud. Con `registrarEntrada` fallando (p. ej. renombrar temporalmente una columna en la base de pruebas), el formulario se envía igual.
- [ ] **Cambiar estado.** En una solicitud, «Cambiar estado» ofrece solo los estados permitidos para el rol; descartar exige motivo (≥ 5 caracteres).
- [ ] **Listado (9.3).** Selección con clic y teclado, buscador sin tildes ni mayúsculas (buscar «pena» encuentra «Peña»), carga de 30 en 30 al bajar, parte superior fija, columnas que no se mueven al buscar, «Mostrando N de M».
- [ ] **Asociado y el buscador.** `asociado1` busca el código de un caso que no es suyo → no aparece (ni en `GET /api/admin/crm/solicitudes?q=…`).
- [ ] **Solicitud crítica (R-16).** Crear una solicitud con urgencia crítica → aviso en el panel de Dirección (y del abogado de turno, ver Entrega 5), correo y push al panel admin.

### Entrega 3 — Asignación

- [ ] **Sin conflicto no se acepta.** En `pendiente_aceptacion`, Dirección intenta aceptar el encargo sin revisión de conflictos → 422 (`R-20`). Con `con_conflicto`, solo se puede descartar.
- [ ] **Ciclo de asignación.** Coordinación propone a `asociado1` como titular → Dirección aprueba → `asociado1` confirma en «Mis asignaciones» → el caso pasa a `en_curso`. Al rechazar (con motivo), el caso vuelve a «aceptada, pendiente de asignación».
- [ ] **Capacidad.** `asociado1` tiene capacidad 1 y ya lleva un caso. Aprobarle otro pide motivo (R-26); con motivo queda registrado como autorización de capacidad en el Historial.
- [ ] **Solo la persona asignada confirma.** Dirección intenta `POST /api/admin/crm/equipo/[id]/responder` de una fila ajena → rechazado (403/422).
- [ ] **Suplente en reserva.** `asociado2` (suplente) no ve el caso ni por la API (404) hasta que Dirección lo active con «Reasignar».

### Entrega 4 — Agenda y seguimiento

- [ ] **Horario.** Dirección configura el horario de `asociado1`; el selector de `/admin/crm/citas/nueva` ofrece solo esas horas. Coordinación y asistencia lo ven sin poder editarlo (`PUT` → 403).
- [ ] **Selector.** No muestra horas ocupadas, bloqueadas (crear un bloqueo), fuera de horario ni de un feriado; los días sin cupo salen deshabilitados («Sin disponibilidad» / «Feriado»).
- [ ] **Carrera de dos navegadores.** Dos sesiones abren la misma hora; la primera agenda; la segunda recibe «Esa hora acaba de ocuparse», con las horas actualizadas y **sin perder** lo escrito.
- [ ] **Cancelar.** Pide motivo, libera la hora, devuelve el caso a calificación y crea la tarea de reagendar (visible en `/admin/crm/tareas`).
- [ ] **Una cita cancelada no se reactiva.** Desde `/admin/agenda` no hay opción de reactivar; por la API, `PATCH` de estado → `CRM-R38`.
- [ ] **Asistencia no ve notas jurídicas.** Como Dirección, crear una nota jurídica y un plazo jurídico. Con `asistencia`, la respuesta de `GET /api/admin/crm/actividades?solicitud=…` no los contiene (revisar el JSON, no solo la pantalla).
- [ ] **Cerrar.** No se cierra un caso con citas futuras activas (`CRM-R18`, la pantalla ofrece cancelarlas). Con tareas pendientes, exige justificarlas (`pendientes_cierre`, `CRM-R14`).
- [ ] **Bloqueo con citas (R-45).** Crear un bloqueo sobre una cita activa: se guarda, no cancela, y devuelve la lista de citas afectadas; Dirección y Coordinación reciben aviso.

### Entrega 5 — Control

- [ ] **Tablero del asociado.** `asociado1` ve solo lo suyo: sus casos por estado, las tareas de sus casos, sus objetivos y **su propia fila** de carga. Comparar los conteos con los de Dirección: deben ser menores o iguales y no incluir casos ajenos. `asistencia` y `externo` ven el tablero básico.
- [ ] **Tablero de Dirección y Coordinación.** Casos por estado (12), vencimientos (vencidas y próximas 7 días; los plazos jurídicos verificados van primero), objetivos incumplidos y carga por persona con barra y «en su límite». Coordinación: sus conteos **no incluyen** el caso reservado (comparar con Dirección).
- [ ] **Objetivos R-43.** Crear una solicitud crítica y esperar 61 minutos sin responder → aparece como incumplida. Una ordinaria recibida el viernes a las 17:00 vence el lunes a las 17:00 (9 h hábiles); un feriado en `configuracion.festivos` se salta. Responder (llamada/mensaje) la saca de la lista.
- [ ] **Tope de 500.** Con 501 solicitudes sin respuesta, el tablero dice «500 o más».
- [ ] **Reportes: permisos.** `asociado1`, `asistencia` y `externo` en `/admin/crm/reportes` → redirigidos; `GET /api/admin/crm/reportes?…` → 403. Dirección y Coordinación entran.
- [ ] **Reportes: período.** Sin `desde`/`hasta` por API → 400. Más de 366 días → 400. Fechas inválidas → 400.
- [ ] **Coordinación no ve reservados en reportes ni exportaciones.** Con el caso reservado dentro del período: el total de solicitudes de Coordinación es uno menos que el de Dirección; el CSV de Coordinación no trae su código; el CSV de Dirección sí.
- [ ] **Métricas.** Con datos conocidos, comprobar a mano: solicitudes por estado/canal/urgencia/área; contactos nuevos; duplicados; citas atendidas / no asistió / canceladas; propuestas y contrataciones; mediana de primera respuesta en horas hábiles; tiempo de asignación (de «aceptada» a titular confirmado); tareas vencidas; descartes y cierres agrupados por texto.
- [ ] **Cierre no es éxito.** Cerrar dos casos con resultados distintos («Ganado», «Desistido»): el reporte los desglosa por resultado.
- [ ] **Exportación.** Con cada filtro (área, canal, responsable) el CSV trae solo las filas correspondientes. Abrirlo en Excel (es-EC): una sola hoja con 18 columnas (separador `;`), tildes correctas, sin celdas que empiecen con `=`, `+`, `-` o `@` sin apóstrofo (crear una solicitud cuyo motivo de descarte empiece con `=1+1` y comprobar que sale `'=1+1`).
- [ ] **Exportación: columnas prohibidas.** El archivo no contiene descripción, objetivo, notas, expediente, nombre, correo, teléfono ni identificación.
- [ ] **Historial de exportaciones.** Cada descarga aparece en `/admin/crm/bitacora` (acción `exportar`) con quién, cuándo, filtros y número de filas, y **ningún dato exportado**. Forzar un fallo de la bitácora (p. ej. revocar temporalmente el permiso de inserción en la base de pruebas): la descarga responde 502 y no entrega el archivo.
- [ ] **Tope de exportación.** Más de 5000 solicitudes en el período → 422 `EXPORTACION_EXCEDE_TOPE`; reportes → 422 `REPORTE_EXCEDE_TOPE`.
- [ ] **Turnos.** Dirección y Coordinación crean un turno para `asociado1`; para una persona inactiva o que no sea abogada → 400. Se permiten dos turnos solapados de personas distintas; para la misma persona → 422. Quitar un turno vigente o futuro funciona y deja `actualizar` con `eliminado: true`; uno terminado no se borra (422).
- [ ] **R-16 con turno.** Con un turno vigente de `asociado1`, una solicitud crítica avisa a Dirección y a `asociado1` (panel y correo; el push solo llega al panel admin). Sin turno vigente, avisa solo a Dirección, sin error. Una solicitud crítica reservada avisa solo a Dirección.

### En todas las entregas

- [ ] **Ningún formulario flotante.** Recorrer todas las pantallas: ni modales, ni `window.confirm`, ni popovers con formularios. Las acciones cortas usan `PanelAccion`.
- [ ] **Ninguna tabla `crm_*` desde el navegador.** En Red, ninguna petición va a `*.supabase.co/rest/v1/crm_*` (solo a `/api/admin/crm/*`); y con la clave anónima, `select` sobre cualquier `crm_*` devuelve vacío o error (RLS sin políticas).
- [ ] **Permisos solo en `lib/crm/permisos.ts`.** Ver la sección 5: hay comparaciones de rol fuera de ese archivo que se corregirán aparte.

---

## 4. Pendientes acumulados del módulo

| # | Pendiente | Detalle |
|---|---|---|
| 1 | **Correo de invitación** | `lib/crm/invitaciones.ts` y `POST usuarios/[id]/invitacion`: verificar que el proyecto Supabase tenga el envío de correos y la URL de redirección configurados; reenvío mientras no se haya definido la contraseña |
| 2 | **`PUT` de horario no atómico** | `lib/crm/horarios.ts` borra e inserta las franjas con restauración «best-effort». Pedir una función en la base que reemplace el horario en una transacción |
| 3 | **Push al personal (E7)** | Hoy el push llega solo a las suscripciones del panel admin (`sendPushToAdmin`, sin tocar `lib/push.ts`). El push personal (al abogado de turno, al responsable de una tarea…) y los recordatorios programados son del E7 |
| 4 | **Horas hábiles supuestas** | `HORARIO_HABIL` = lunes a viernes 09:00–18:00, y los objetivos (crítica 60 min corridos; alta 2 h, media 8 h, ordinaria 9 h hábiles) son supuestos de `lib/crm/config.ts`. Confirmar con el estudio. Los feriados se leen de `configuracion.festivos` |
| 5 | **`/mis-citas`** | Muestra `atendida` y `no_asistio` como «Pendiente» (no se tocó: es del portal de clientes). Avisar al módulo dueño |
| 6 | **Revisión de E2** | Diff de `app/api/contact/route.ts` y `app/api/appointments/route.ts` (llamada a `registrarEntrada` con `after()`; 409 «Horario no disponible») pendiente de aprobación del responsable de esos archivos; y de los archivos de la sección 12 (`app/api/appointments/[id]/route.ts`, `lib/schemas.ts`, `app/admin/agenda/*`) |
| 7 | **Restricción de turnos en la base** | `crm_turnos` no impide que la misma persona tenga turnos cruzados; hoy se comprueba en el servidor (dos peticiones simultáneas podrían colarse). Pedir una restricción de exclusión |
| 8 | **Catálogo E5** | `lib/crm/catalogo.ts` devuelve listas vacías si las tablas no existen; con el catálogo real, probar los selectores de área y servicio |
| 9 | **Listas de roles en rutas y páginas** | `autorizarApi([...])` y `personalDePagina([...])` llevan listas literales de roles (más `ROLES_LECTURA`/`ROLES_ESCRITURA` en algunas rutas). Es el filtro de entrada, coherente con la matriz 4.3, pero vive fuera de `permisos.ts`. Candidato a un paso aparte: nombrarlas en `permisos.ts` |
| 10 | **Filtro «titular» con muchos casos** | El filtro pasa los ids del último titular en la consulta; con más de 300 casos responde 422 `FILTRO_TITULAR_EXCEDE` (límite práctico de la URL). Si hace falta, resolverlo en la base |

---

## 5. Permisos: dónde se deciden

Todas las decisiones de permiso por rol viven en `lib/crm/permisos.ts` (funciones como `puedeMarcarReserva`, `puedeGestionarEquipo`, `puedeCambiarEstado`, `categoriaAlcance`, `puedeVerFicha`…). Las rutas, páginas y librerías las llaman; no comparan roles. En `estados.ts` quedan solo los datos (tabla de transiciones R-12); la decisión final de quién puede cada cambio es `puedeCambiarEstado` (8.1).

Excepciones que NO son permisos y se dejan donde están:

- **Coherencia rol ↔ `es_abogado`** (un asociado es siempre abogado; un externo no ejerce patrocinio): refleja los CHECK de `crm_personal` en M4. Está en `components/crm/PersonalForm.tsx`, `UsuarioForm.tsx`, `app/api/admin/crm/personal/[id]/route.ts` y `usuarios/route.ts` y `usuarios/[id]/route.ts`.
- **`lib/crm/roles.ts`**: conversión de rol a `app_metadata.role` (Dirección = `admin`).
- **`lib/crm/avisos.ts`**: a qué roles se dirige un aviso (`roles: ['direccion']`…). Es enrutamiento de notificaciones, no una comprobación de acceso.
