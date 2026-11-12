# Especificación de desarrollo — Módulo E6 Mini-CRM · Imperium Iuris

**Para:** Claude Code, trabajando en el repositorio del proyecto.
**Versión:** 1.0 · 12-nov-2026
**Responsable del módulo:** Mario Reyes (Estudiante 4, módulo E6).

Este documento es la fuente de verdad para construir el CRM. Si algo del código existente lo contradice, **detente y pregunta** antes de improvisar.

Archivos que acompañan a esta especificación (cópialos al repositorio donde se indica):

| Archivo | Destino en el repo | Qué es |
|---|---|---|
| `20261112120000_m4_crm.sql` | `supabase/migrations/` | Migración M4: 17 tablas, 1 vista, triggers y funciones del CRM |
| `20261112120100_m5_crm_citas.sql` | `supabase/migrations/` | Migración M5: cambios a `public.citas` (abogado, duración, sin cruces) |
| `pruebas_reglas_crm.sql` | `docs/crm/` | 132 pruebas de las reglas de la base. Solo para Postgres local |
| `CRM_maqueta_listado.html` | `docs/crm/` | Maqueta de referencia del patrón de listado |

---

## 0. Reglas de trabajo (obligatorias)

1. **Lee primero:** `CLAUDE.md`, `README.md`, `docs/AUDITORIA_SEGURIDAD.md`, `middleware.ts`, `lib/admin-auth.ts`, `lib/api-errors.ts`, `lib/schemas.ts`, `lib/supabase.ts`, `app/admin/layout.tsx`, `components/admin/AdminNav.tsx`, `app/admin/contacto/*`, `app/api/admin/consultas/[id]/route.ts`, `app/api/contact/route.ts`, `app/api/appointments/route.ts`, y el componente del menú desplegable de usuario del sitio público (búscalo por los textos "Mis citas" / "Panel Admin" / "Modo edición"). Sigue sus patrones; no inventes otros.
2. **Base de datos:**
   - **NO ejecutes** ninguna migración, seed ni SQL contra ningún proyecto de Supabase. **NO** modifiques tablas, políticas, permisos, funciones ni buckets. Las migraciones las aplica una persona autorizada.
   - **NO edites** los archivos `.sql` entregados. Si crees que falta algo en el esquema, detente y repórtalo.
   - No leas ni imprimas `.env.local`. Nunca escribas `SUPABASE_SERVICE_ROLE_KEY` en código, logs, commits ni mensajes.
3. **Dependencias:** no instales paquetes, no ejecutes `npm update` ni `npm audit fix`. Todo se hace con lo que ya está en `package.json` (Next.js 15 App Router, TypeScript strict, Tailwind, Zod, react-hook-form, Supabase, Resend, web-push, lucide-react).
4. **Git:** nunca trabajes en `main`. Una rama por entrega (`e6/entrega-1-cimientos`, …) y un Pull Request por entrega. Los cambios a archivos compartidos (sección 12) van en commits separados y claramente descritos.
5. **Verificación antes de cada PR:** `npx tsc --noEmit`, el lint del proyecto y `npm run build` sin errores. Si el proyecto no tiene framework de pruebas, no instales uno: entrega la lista de verificación manual de la sección 14.
6. **Cuando dudes, pregunta.** En especial ante: nombres de columnas que no coincidan, una ruta existente que se comporte distinto a lo descrito aquí, o cualquier cosa que toque otro módulo (E1, E2, E3, E5, E7, E8).

---

## 1. Contexto y alcance

Imperium Iuris es el portal de un estudio jurídico (Guayaquil, Ecuador). El CRM organiza **contactos**, **solicitudes** (cada pedido de ayuda; se vuelve "caso" al aceptarse), el **personal** que las atiende, su **agenda** y el **seguimiento**. Vive en `/admin/crm`.

**Dentro del E6 (cinco entregas, en este orden):**

| # | Entrega | Incluye |
|---|---|---|
| 1 | Cimientos | Capa de permisos, gestión de usuarios, navegación (opción "CRM"), bitácora, tablero básico |
| 2 | Captación | Contactos, duplicados, solicitudes y sus estados, ingreso automático desde formulario web y citas, bandeja de validación |
| 3 | Asignación | Fichas del personal, áreas de referencia, revisión de conflictos, asignación en 3 pasos, capacidad, reasignación |
| 4 | Agenda y seguimiento | Horarios y bloqueos, citas sin cruces, tareas y plazos, cronología, expediente, avisos |
| 5 | Control | Tablero completo, objetivos de atención, reportes, exportación CSV, turnos |

**Fuera del E6 (no lo construyas):** documentos y versiones, honorarios y cobros, WhatsApp, clasificación por IA (E1/E3), sincronización con Google Calendar (E2), recordatorios programados por cron (E7), consentimiento y eliminación de datos (E8), resumen del caso para el cliente.

---

## 2. Arquitectura

- **Patrón del proyecto:** página Server Component que lee con el cliente `service_role` de `lib/supabase.ts` → componente cliente para la interacción → rutas `app/api/admin/crm/**` para escribir.
- **El navegador nunca consulta Supabase para el CRM.** Todas las tablas `crm_*` tienen RLS activado sin políticas; solo `service_role` accede.
- **La autorización es del servidor.** Como el servidor entra con una sola credencial, la base no sabe quién es el usuario: todo permiso por rol o por caso se decide en `lib/crm/permisos.ts`. Ninguna ruta ni página decide permisos por su cuenta.
- **La base es la última barrera.** Impone las reglas marcadas (BD) en la sección 5 y responde con errores que el servidor traduce (sección 7).
- **Zona horaria:** todo cálculo y toda fecha mostrada usa `America/Guayaquil`.

### 2.1 Archivos nuevos

```
lib/crm/
  permisos.ts        # getPersonal(), requireRol(), puedeVerSolicitud(), filtros de visibilidad
  errores.ts         # traduce errores de la base a respuestas HTTP (sección 7)
  schemas.ts         # esquemas Zod del CRM
  normalizar.ts      # teléfono E.164, correo, texto de búsqueda, cédula y RUC
  bitacora.ts        # registrar(accion, entidad, ...)
  estados.ts         # tabla de transiciones, permisos por transición, cambiarEstado()
  ingesta.ts         # registrarEntrada() — contrato para web, citas, E1 y E3
  etapas.ts          # recalcularEtapa(contactoId)
  sugerencias.ts     # orden de candidatos para asignar
  disponibilidad.ts  # horas libres de un abogado
  avisos.ts          # crea y envía notificaciones (best-effort)
  config.ts          # constantes: duración de cita, objetivos de atención, horario laboral
  fechas.ts          # utilidades de fecha en America/Guayaquil
app/admin/crm/**     # páginas (sección 9)
app/api/admin/crm/** # rutas (sección 8)
components/crm/**    # CrmNav, CrmTopBar, ListaSeleccionable, PanelAccion, Indicador, etc.
```

### 2.2 Identificadores: no los confundas

| Columna | Apunta a |
|---|---|
| `created_by`, `estado_por`, `autor_id`, `propuesto_por`, `aprobado_por`, `capacidad_autorizada_por`, `conflicto_revisado_por`, `cancelada_por`, `resuelto_por`, `autorizado_por`, `crm_bitacora.user_id`, `crm_notificaciones.destinatario_id` y todo parámetro `p_usuario` | **`auth.users.id`** (la cuenta) |
| `personal_id`, `responsable_id`, `plazo_verificado_por`, `abogado_id`, `desde_personal_id`, `hacia_personal_id`, `p_nuevo_titular`, `p_responsable_tarea` | **`crm_personal.id`** (la ficha) |

---

## 3. Modelo de datos (resumen)

Lee los dos `.sql` completos: sus comentarios explican cada restricción. Resumen:

| Tabla | Para qué |
|---|---|
| `crm_personal` | Toda persona que usa el CRM. **Fuente de verdad del rol** (`rol`, `activo`) |
| `crm_personal_areas` | Titular y suplente **de referencia** por área. No da acceso a casos |
| `crm_horarios`, `crm_bloqueos`, `crm_turnos` | Horario semanal, ausencias y turnos fuera de horario |
| `crm_contactos` | Personas y empresas. `correo_normalizado` y `busqueda` son columnas generadas (no las escribas) |
| `crm_contacto_vinculos` | Personas de contacto de una empresa |
| `crm_posibles_duplicados` | Pares a revisar por una persona |
| `crm_solicitudes` | El pedido/caso. `codigo` lo asigna la base (`S26-0041`) |
| `crm_solicitud_estados` | Historial de estados. Lo llena un trigger; solo lectura |
| `crm_solicitud_areas` | Áreas adicionales |
| `crm_expedientes` | Datos procesales (1:1) |
| `crm_solicitud_equipo` | **Define quién ve cada caso.** Ciclo: `propuesto → pendiente_confirmacion → activo → finalizado` · `rechazado` · suplente `en_reserva` |
| `crm_reasignaciones` | Historial de cambios de titular. Solo inserción |
| `crm_actividades` | Cronología: notas, llamadas, tareas, plazos |
| `crm_notificaciones` | Avisos y su resultado |
| `crm_bitacora` | Auditoría. Solo inserción |
| `crm_v_carga_personal` | Vista: carga y tareas por persona |
| `citas` (existente, ampliada en M5) | + `abogado_id`, `solicitud_id`, `duracion_min`, `reagendada_de`, datos de cancelación, estados `atendida` y `no_asistio` |

Catálogo del módulo E5 (solo lectura para el CRM): `areas_practica` y `servicios` (`activo = true` para ofrecerlos).

### 3.1 Funciones de la base (llámalas con `supabase.rpc`)

Estas operaciones cambian varias tablas y deben usarse **siempre** en lugar de hacer los pasos a mano:

| Función | Uso |
|---|---|
| `crm_aprobar_asignacion(p_equipo, p_usuario, p_supera_capacidad, p_motivo_capacidad)` | Dirección aprueba. Si es el titular, el caso pasa a `asignada` |
| `crm_responder_asignacion(p_equipo, p_usuario, p_acepta, p_motivo)` | La persona asignada confirma (→ `en_curso`) o rechaza (→ `aceptada_pendiente_asignacion`). La base verifica que `p_usuario` sea su cuenta |
| `crm_reasignar_titular(p_solicitud, p_nuevo_titular, p_motivo, p_autorizado_por, p_detalle, p_entrega_documentada, p_supera_capacidad, p_motivo_capacidad)` | Cambia el titular o activa al suplente |
| `crm_fusionar_contactos(p_conserva, p_fusionada, p_usuario, p_motivo)` | Fusiona dos fichas |
| `crm_cancelar_cita(p_cita, p_origen, p_motivo, p_usuario, p_responsable_tarea)` | Cancela, libera la hora, devuelve el caso a calificación y crea la tarea de reagendar |
| `crm_carga_titular(p_personal, p_excluir_solicitud)` | Carga actual de una persona |

Todas escriben su propio registro en `crm_bitacora`: **no lo dupliques** desde el servidor.

`crm_bitacora.accion` solo admite los valores de su CHECK (ver M4): `crear`, `actualizar`, `cambiar_estado`, `revisar_conflicto`, `proponer_asignacion`, `fusionar`, `descartar_duplicado`, `cerrar`, `reabrir`, `agendar_cita`, `reagendar_cita`, `verificar_plazo`, `exportar`, `ver_reservado`, `acceso_excepcional`, `crear_usuario`, `cambiar_rol`, `desactivar_usuario`, `reactivar_usuario`, entre otros. No inventes acciones nuevas.

---

## 4. Roles y permisos

### 4.1 Roles

`direccion`, `coordinacion`, `asistencia`, `asociado`, `externo`. Un rol por persona, guardado en `crm_personal.rol`.

- **Fuente de verdad:** `crm_personal` (rol y `activo`), consultada **en cada petición**. Así desactivar a alguien surte efecto inmediato.
- **Espejo para el middleware:** `app_metadata.role` del usuario. `direccion` se refleja como `'admin'` (Dirección equivale al admin actual y conserva acceso a todo `/admin`). Los demás roles se reflejan con su mismo nombre.
- **Arranque:** si un usuario que cumple `isAdminUser()` no tiene ficha en `crm_personal`, créala en su primer ingreso al CRM con rol `direccion` (nombres tomados del perfil o, si no hay, "Administrador" / "Imperium Iuris").

### 4.2 Capa de permisos (`lib/crm/permisos.ts`)

Toda ruta y toda página del CRM ejecuta, en este orden:

1. Sesión con `getUser()`. Sin sesión → 401 (página: redirige a login).
2. `getPersonal(user)` → ficha activa. Sin ficha o inactiva → 403.
3. `requireRol(personal, [...])` según la matriz 4.3 → 403.
4. Para un caso concreto: `puedeVerSolicitud(personal, solicitud)`; si no → **404** (no 403, para no revelar que existe).
5. Validación Zod del cuerpo → 400.

**Visibilidad de un caso** (`puedeVerSolicitud`):

- `direccion`: siempre. Si el caso tiene `reserva_reforzada` y no está en el equipo, registra `ver_reservado` en la bitácora.
- `coordinacion`: todos, **excepto** los de `reserva_reforzada` donde no esté activo en el equipo.
- `asistencia`: igual que coordinación, pero nunca recibe actividades con `es_juridica = true` ni los datos de `crm_expedientes`.
- `asociado` y `externo`: solo si tienen una fila de equipo `activo`. Con `pendiente_confirmacion` reciben un **resumen** (código, área, servicio, urgencia, descripción) sin datos del contacto. `propuesto` y `en_reserva` no dan acceso.
- `externo`: vista reducida aun estando activo — resumen del caso y sus propias tareas; sin datos de contacto del cliente ni el resto de la cronología.
- **Caso cerrado:** solo lectura para todos. Lo ven Dirección, coordinación y, del equipo, únicamente el titular.

**Los filtros de visibilidad se aplican en la consulta** (por ejemplo, `.in('id', idsPermitidos)` y `.eq('reserva_reforzada', false)`), nunca filtrando después de traer los datos: así la carga progresiva y los conteos son correctos.

### 4.3 Matriz de acciones

| Acción | Dirección | Coordinación | Asistencia | Asociado | Externo |
|---|---|---|---|---|---|
| Crear usuarios, cambiar rol, desactivar | ✔ | — | — | — | — |
| Fichas del personal, capacidad, áreas | ✔ | ✔ | — | — | — |
| Horario semanal de cada abogado | ✔ | Ver | Ver | Ver el suyo | — |
| Bloqueos (ausencias) | ✔ | ✔ | — | Los suyos | — |
| Crear y editar contactos | ✔ | ✔ | ✔ | Editar los de sus casos | — |
| Marcar un posible duplicado | ✔ | ✔ | ✔ | — | — |
| Fusionar o descartar duplicados | ✔ | ✔ | — | — | — |
| Registrar solicitudes | ✔ | ✔ | ✔ | — | — |
| Calificar (área, servicio, urgencia) | ✔ | ✔ | ✔ | En sus casos | — |
| Registrar revisión de conflictos | ✔ | ✔ | — | — | — |
| Aceptar o descartar el encargo | ✔ | — | — | — | — |
| Descartar un envío en la bandeja de validación | ✔ | ✔ | ✔ | — | — |
| Proponer equipo | ✔ | ✔ | — | — | — |
| Aprobar asignación / autorizar sobre capacidad | ✔ | — | — | — | — |
| Confirmar o rechazar la propia asignación | — | — | — | ✔ | ✔ |
| Reasignar titular / activar suplente | ✔ | — | — | — | — |
| Marcar reserva reforzada | ✔ | ✔ | — | En sus casos | — |
| Quitar reserva reforzada | ✔ | — | — | — | — |
| Agendar, reagendar y cancelar citas | ✔ | ✔ | ✔ | En sus casos | — |
| Crear tareas y seguimientos | ✔ | ✔ | ✔ (no jurídicas) | En sus casos | — |
| Completar una tarea | Responsable, o D/C | | | La suya | La suya |
| Escribir notas jurídicas | ✔ | ✔ | — | En sus casos | En sus casos |
| Verificar un plazo jurídico | ✔ | — | — | Titular | — |
| Pausar / reanudar (en curso ↔ en espera) | ✔ | ✔ | — | Titular | — |
| Cerrar un caso | ✔ | ✔ | — | Titular | — |
| Reabrir un caso cerrado o descartado | ✔ | — | — | — | — |
| Reportes | ✔ | ✔ sin reservados | — | Su carga | — |
| Exportar CSV | ✔ | ✔ sin reservados | — | — | — |
| Ver bitácora | Completa | La de cada caso | — | La de sus casos | — |

**Protecciones:** nadie cambia su propio rol ni se desactiva a sí mismo; siempre queda una Dirección activa (la base lo impone, R-55).

---

## 5. Reglas de negocio

**BD** = la impone la base (ya está en las migraciones; el servidor valida antes para dar un mensaje claro). **Srv** = la implementas tú en el servidor.

### Contactos y duplicados
- **R-01 (BD)** Persona requiere nombres; empresa requiere razón social.
- **R-02 (BD)** No hay dos fichas vigentes con el mismo tipo y número de identificación.
- **R-03 (BD+Srv)** Formato de identificación en la base; dígito verificador en el servidor (sección 6). Teléfono normalizado a E.164 por el servidor.
- **R-04 (Srv)** Un teléfono o correo repetido no bloquea: crea una fila en `crm_posibles_duplicados` (con `contacto_a < contacto_b`).
- **R-05 (BD)** Nunca se fusiona automáticamente. Fusionar = `crm_fusionar_contactos`. Una ficha fusionada no se edita ni recibe solicitudes.
- **R-06 (BD)** `etapa_relacion = 'no_continua'` exige motivo.
- **R-07 (BD)** Una empresa tiene varias personas de contacto; los vínculos unen empresa con persona.

### Solicitudes
- **R-10 (BD)** El código lo asigna la base y no se modifica. No lo envíes en el INSERT.
- **R-11 (Srv+BD)** El formulario web y la reserva de cita crean o reutilizan el contacto y generan la solicitud en `nueva` (sección 10). La misma consulta o cita no genera dos solicitudes (índice único por origen).
- **R-12 (BD)** Transiciones permitidas:

| Desde | Hacia |
|---|---|
| `nueva` | `en_calificacion` · `descartada` |
| `en_calificacion` | `pendiente_informacion` · `consulta_agendada` · `propuesta_enviada` · `descartada` |
| `pendiente_informacion` | `en_calificacion` · `descartada` |
| `consulta_agendada` | `en_calificacion` · `propuesta_enviada` · `descartada` |
| `propuesta_enviada` | `pendiente_aceptacion` · `descartada` |
| `pendiente_aceptacion` | `aceptada_pendiente_asignacion` · `descartada` |
| `aceptada_pendiente_asignacion` | `asignada` (solo vía `crm_aprobar_asignacion`) · `descartada` |
| `asignada` | `en_curso` · `aceptada_pendiente_asignacion` (solo vía `crm_responder_asignacion`) |
| `en_curso` | `en_espera` · `cerrada` |
| `en_espera` | `en_curso` · `cerrada` |
| `cerrada` | `en_curso` (reapertura) |
| `descartada` | `en_calificacion` (reapertura) |

  `pendiente_aceptacion` significa: el cliente aceptó la propuesta y falta que Dirección acepte el encargo.
- **R-13 (BD)** Espera, descarte, cierre, reapertura y rechazo de asignación exigen motivo. El motivo debe enviarse **en ese mismo cambio** (`motivo_estado`); la base no acepta el heredado.
- **R-14 (BD)** Cerrar exige `resultado_cierre`. Con tareas pendientes, exige además `pendientes_cierre`.
- **R-15 (BD)** El servicio pertenece al área principal; solo áreas y servicios activos en casos nuevos.
- **R-16 (Srv)** Urgencia `critica`: aviso inmediato a Dirección y al abogado de turno (`crm_turnos` vigente), sin esperar la calificación.
- **R-17 (BD)** El estado procesal (`crm_expedientes`) es independiente del estado de la solicitud.
- **R-18 (BD)** No se cierra ni descarta un caso con citas futuras activas. El servidor ofrece cancelarlas primero.
- **R-19 (Srv)** Al descartar, las tareas pendientes del caso pasan a `cancelada`.

### Conflictos, asignación y capacidad
- **R-20 (BD)** Sin revisión de conflictos con resultado `sin_conflicto` no se acepta el encargo ni se asigna.
- **R-21 (BD)** Con `con_conflicto` el caso solo puede descartarse.
- **R-22 (BD)** Asignación en tres pasos: proponer (INSERT en `crm_solicitud_equipo` con estado `propuesto`), aprobar (`crm_aprobar_asignacion`), responder (`crm_responder_asignacion`).
- **R-23 (BD)** Un solo titular vigente por caso; la misma persona no figura dos veces vigente.
- **R-24 (BD)** Solo personal activo. Titular, suplente y coordinador: abogado con habilitación verificada. Externo: solo como perito y con acuerdo de confidencialidad.
- **R-25 (Srv)** Orden de la sugerencia: 1) titular de referencia del área, 2) suplente de referencia, 3) demás abogados habilitados del área; dentro de cada grupo, menor `carga / capacidad`, luego misma ciudad que el contacto. Muestra siempre carga y capacidad.
- **R-26 (BD)** Carga = casos `asignada`, `en_curso` o `en_espera` donde es titular. En el límite, aprobar exige `p_supera_capacidad = true` con motivo. `capacidad_maxima` vacía = sin límite.
- **R-27 (BD)** Cambio de titular y activación del suplente con `crm_reasignar_titular`.
- **R-28 (BD)** Un titular y un suplente de referencia por área, ambos abogados activos.
- **R-29 (Srv)** Conflicto descubierto con el caso en curso: se resuelve reasignando con motivo `conflicto_interes` o cerrando.

### Citas y agenda
- **R-30 (BD)** Dos citas activas (`pendiente` o `confirmada`) del mismo abogado no se cruzan. Contiguas sí.
- **R-31 (BD)** Sin abogado, una sola cita activa por fecha y hora.
- **R-32 (Srv)** La cita cae dentro del horario del abogado y fuera de sus bloqueos. La base exige además que sea un abogado activo. **El horario de cada abogado lo establece Dirección desde el CRM** (`crm_horarios`); no hay un horario fijo en el código. Un abogado sin horario configurado no tiene horas disponibles.
- **R-33 (Srv)** El selector muestra solo horas libres; si la base rechaza por cruce, responde 409 con las horas libres actualizadas.
- **R-34 (Srv+BD)** No se agenda en el pasado. La consulta dura **60 min** (constante `DURACION_CITA_MIN` en `config.ts`; el formulario no la deja cambiar por ahora). La base admite entre 15 y 480 para cuando el estudio decida otra duración.
- **R-35 (BD)** Cancelar libera la hora. Reagendar = cambiar fecha/hora de la misma cita (la base revalida) y registrar en bitácora el horario anterior. Una cita nueva tras una cancelada lleva `reagendada_de`.
- **R-36 (BD)** Fin posterior a inicio en horarios, bloqueos, turnos y citas.
- **R-37 (BD)** El CRM cancela siempre con `crm_cancelar_cita` (motivo ≥ 5 caracteres y origen `cliente`, `estudio` o `abogado`).
- **R-38 (BD)** Una cita cancelada o concluida no vuelve a estar activa.
- **R-39 (Srv)** `atendida` y `no_asistio` solo se marcan en citas cuya hora ya pasó.

### Tareas, plazos y avisos
- **R-40 (BD)** Toda tarea tiene responsable, vencimiento y estado.
- **R-41 (BD)** Un plazo jurídico es una tarea de un caso; solo lo verifica el titular activo o Dirección.
- **R-42 (Srv)** En las bandejas, un plazo jurídico verificado va antes que la urgencia comercial.
- **R-43 (Srv)** Objetivos de primer contacto (configurables en `lib/crm/config.ts`): crítica inmediata, alta 2 h hábiles, media 8 h hábiles, ordinaria 1 día hábil. Se miden contra `primera_respuesta_at`. Las horas hábiles de este cálculo son una constante aparte (`HORARIO_HABIL`, supuesto: lunes a viernes 09:00–18:00); no dependen del horario de ningún abogado.
- **R-44 (BD+Srv)** Cada aviso se guarda con su resultado. Un aviso fallido **nunca** impide ni deshace la acción principal.
- **R-45 (Srv)** Al crear un bloqueo o desactivar a una persona con citas activas en ese período, no se cancelan solas: se guarda y se devuelve la lista para reagendarlas o reasignarlas.

### Seguridad, historial y archivo
- **R-50 (BD)** Bitácora, historial de estados y reasignaciones: solo inserción.
- **R-51 (Srv)** Toda escritura deja registro en `crm_bitacora` con usuario, valores anterior y nuevo. No registres en la bitácora contraseñas ni el contenido de notas jurídicas.
- **R-52 (BD)** No existe borrado de contactos, solicitudes, expedientes ni actividades.
- **R-53 (Srv)** Los casos con reserva reforzada no aparecen en búsquedas, avisos, reportes ni exportaciones de quien no esté autorizado.
- **R-54 (Srv)** La exportación respeta permisos y registra quién, cuándo y con qué filtros.
- **R-55 (BD)** Siempre queda una Dirección activa.

---

## 6. Validaciones de entrada (Zod, en `lib/crm/schemas.ts`)

| Campo | Regla |
|---|---|
| Texto en general | `trim()`; cadenas vacías se convierten en `null` |
| Nombres, apellidos, razón social | 2 a 120 caracteres |
| Cédula | 10 dígitos; provincia 01–24 o 30; tercer dígito < 6; dígito verificador módulo 10. Si falla → 400 |
| RUC | 13 dígitos; provincia válida; termina en `001` o superior. Si el dígito verificador no cuadra, **se acepta** con `identificacion_validada = false` y la ficha muestra "no validado" junto al RUC (decisión confirmada) |
| Pasaporte / extranjera | 4 a 20, `[A-Z0-9-]`; convertir a mayúsculas |
| Teléfono | Normalizar a E.164: `09XXXXXXXX` → `+5939XXXXXXXX`; fijo `0[2-7]XXXXXXX` → `+593…`; ya en `+…` se valida. Si no se puede → 400 |
| Correo | Formato válido, máx. 254 |
| Descripción de solicitud | 10 a 5000 |
| Motivo | 5 a 500, obligatorio donde lo exige la regla |
| UUID | `z.string().uuid()` en todo identificador |
| Enumeraciones | Los valores exactos de los CHECK de la base |
| Fechas | ISO; vencimiento de tarea y cita no en el pasado |
| Duración de cita | 15–480, múltiplo de 15 |
| Capacidad | Entero > 0 o `null` |
| Búsqueda (`q`) | máx. 80; normalizar igual que la columna `busqueda` (minúsculas, sin tildes); escapar `%`, `_`, `,` y paréntesis antes de usarla en filtros |

**Edición simultánea:** los `PATCH` de contactos, solicitudes, expedientes y personal reciben el `updated_at` que el cliente tenía. Aplica el UPDATE con `.eq('updated_at', valor)`; si no afecta filas → 409 "Alguien más modificó este registro; recarga".

---

## 7. Errores (`lib/crm/errores.ts`)

Respuesta uniforme: `{ error: string, codigo?: string, campos?: Record<string,string>, datos?: unknown }`.

| HTTP | Cuándo |
|---|---|
| 400 | Zod. Devuelve `campos` |
| 401 / 403 | Sin sesión / sin permiso |
| 404 | No existe o no le corresponde verlo |
| 409 | Choque con el estado actual |
| 422 | Regla de negocio incumplida |
| 502 | Fallo inesperado; usa `supabaseErrorResponse` (no filtres `error.message`) |

Traducción de errores de la base (`error.code` y `error.message` de Supabase):

| Lo que llega | Respuesta |
|---|---|
| `P0001` y mensaje que empieza con `CRM-Rxx:` | 422, `codigo: 'R-xx'`, `error` = el texto tras los dos puntos |
| `23P01` con `citas_sin_cruce_abogado` | 409 "Esa hora acaba de ocuparse", `datos` = horas libres actualizadas |
| `23P01` con `crm_horarios_sin_solape` | 422 "Esa franja se cruza con otra del mismo día" |
| `23505` con `citas_un_turno_sin_abogado` | 409 "Horario no disponible" |
| `23505` con `crm_contactos_identificacion_key` | 409 "Ya existe una ficha con esa identificación", `datos` = id de la ficha |
| `23505` con `crm_solicitud_equipo_un_titular` | 422 "El caso ya tiene un titular" |
| `23505` con `crm_solicitud_equipo_miembro_vigente` | 422 "Esa persona ya está en el equipo" |
| `23505` con `crm_personal_areas_un_titular` / `_un_suplente` | 422 "El área ya tiene titular/suplente de referencia" |
| `23505` con `crm_solicitudes_origen_key` | No es error: devuelve la solicitud existente |
| `23514` (CHECK) | 422 con mensaje genérico "El dato no cumple una regla del sistema" y registra el nombre de la restricción en el log del servidor |
| Cualquier otro | 502 genérico |

Los CHECK no deberían dispararse nunca si Zod y los permisos están bien: si aparece un `23514`, es un defecto de validación que hay que corregir.

---

## 8. Rutas API (`app/api/admin/crm/…`)

Convenciones: validación con Zod; **listados con carga progresiva** (`?cursor=…&limite=30`, máximo 50; orden estable por fecha descendente e `id`; respuesta `{ items, siguienteCursor, total }`); solo se ordena por campos de una lista permitida.

### Entrega 1
| Ruta | Quién | Notas |
|---|---|---|
| `GET yo` | Todo el personal | Ficha, rol y lista de permisos para armar el menú |
| `GET usuarios` · `POST usuarios` | Dirección | **Invitación por correo:** crea la cuenta con `auth.admin.inviteUserByEmail` (cliente service_role), asigna `app_metadata.role` y crea la ficha en `crm_personal`. Si la ficha falla, elimina la cuenta recién creada. El usuario define su propia contraseña desde el enlace: reutiliza la página de restablecer contraseña del proyecto si existe; si no, crea `/admin/crm/acceso` (única pantalla del CRM accesible con la sesión del enlace y sin ficha completa) que pide la contraseña dos veces y llama a `auth.updateUser`. Dirección nunca ve ni escribe contraseñas. Antes de implementar, comprueba que el proyecto Supabase tenga configurado el envío de correos y la URL de redirección; si no, **detente y avisa** |
| `POST usuarios/[id]/invitacion` | Dirección | Reenvía la invitación mientras el usuario no haya definido su contraseña. Bitácora: `actualizar` |
| `PATCH usuarios/[id]` | Dirección | Cambia rol, datos o `activo`. No sobre la propia cuenta. Al cambiar rol actualiza también `app_metadata.role`. Al desactivar: `activo = false`, bloquea la cuenta en Auth y devuelve los casos y citas activas de esa persona (R-45) |
| `GET bitacora` | Dirección (todo); coordinación y asociado (por caso visible) | Filtros: entidad, usuario, acción, fechas |
| `GET catalogo` | Todo el personal | Áreas y servicios activos |
| `GET tablero` | Todo el personal | Versión básica: pendientes propios y contadores |

### Entrega 2
| Ruta | Quién | Notas |
|---|---|---|
| `GET contactos`, `GET contactos/[id]` | Según 4.2 | Búsqueda por `busqueda`. Excluye fusionados salvo que se pida |
| `POST contactos` | D, C, A | R-01 a R-04. Con `?verificar=1` solo devuelve coincidencias sin guardar; el formulario las muestra antes de confirmar |
| `PATCH contactos/[id]` | D, C, A; asociado en sus casos | No edita fichas fusionadas ni archivadas |
| `POST`, `DELETE contactos/[id]/vinculos` | D, C, A | R-07 |
| `GET duplicados`, `GET duplicados/[id]` | D, C, A | |
| `POST duplicados` | D, C, A | Marcar manualmente un posible duplicado |
| `POST duplicados/[id]/fusionar` | D, C | `crm_fusionar_contactos`. Recibe cuál ficha se conserva |
| `POST duplicados/[id]/descartar` | D, C | |
| `GET solicitudes`, `GET solicitudes/[id]` | Según 4.2 | Búsqueda por código o por contacto (`busqueda`); filtros por estado, urgencia, área, titular |
| `POST solicitudes` | D, C, A | Nace `nueva`. No envíes `codigo` ni `estado`. Si es crítica → R-16 |
| `PATCH solicitudes/[id]` | D, C, A; asociado en sus casos | Solo datos de calificación. **Nunca** cambia `estado` |
| `POST solicitudes/[id]/estado` | Según 8.1 | Única vía manual para cambiar el estado |
| `POST solicitudes/[id]/validar` | D, C, A | Quita `requiere_validacion`, o descarta el envío con motivo |

### Entrega 3
| Ruta | Quién | Notas |
|---|---|---|
| `GET personal`, `GET personal/[id]` | D, C; cada quien su ficha | Incluye carga desde `crm_v_carga_personal` |
| `PATCH personal/[id]` | D, C | Datos profesionales, habilitación, capacidad |
| `PUT personal/[id]/areas` | D, C | R-28 |
| `POST solicitudes/[id]/conflicto` | D, C | Resultado y detalle obligatorios |
| `GET solicitudes/[id]/sugerencias` | D, C | R-25 |
| `POST solicitudes/[id]/equipo` | D, C | Propone (estado `propuesto`) |
| `POST equipo/[id]/aprobar` | Dirección | `crm_aprobar_asignacion`. Si la base responde R-26, la pantalla pide el motivo y reintenta con `p_supera_capacidad = true` |
| `POST equipo/[id]/responder` | Solo la persona asignada | `crm_responder_asignacion` |
| `POST equipo/[id]/finalizar` | D, C | Retira a un miembro que no es titular |
| `POST solicitudes/[id]/reasignar` | Dirección | `crm_reasignar_titular` |
| `GET asignaciones` | Asociado, externo | Sus filas `pendiente_confirmacion` con el resumen del caso |

### Entrega 4
| Ruta | Quién | Notas |
|---|---|---|
| `GET personal/[id]/horarios` | D, C, A, el propio abogado | Solo lectura para todos menos Dirección |
| `PUT personal/[id]/horarios` | Dirección | Reemplaza las franjas de la semana. Varias franjas por día permiten dejar libre el almuerzo. Si el cambio deja citas activas fuera del horario, se guarda y se devuelve la lista para reagendarlas (igual que R-45) |
| `GET`, `POST`, `DELETE personal/[id]/bloqueos` | D, C, el propio abogado | R-45 |
| `GET disponibilidad` | Quien puede agendar | Parámetros: `abogado_id`, `desde`, `hasta` (máx. 31 días), `duracion`. Sección 11 |
| `GET citas`, `POST citas` | D, C, A; asociado en sus casos | Revalida disponibilidad al guardar. Si la solicitud está `en_calificacion`, pásala a `consulta_agendada` |
| `PATCH citas/[id]` | Los mismos | Reagendar, asignar abogado, marcar `atendida` / `no_asistio` (R-39) |
| `POST citas/[id]/cancelar` | Los mismos | `crm_cancelar_cita`. Responsable de la tarea: quien cancela si es asistencia o coordinación; si no, la primera persona activa de asistencia, luego coordinación, luego Dirección |
| `GET`, `POST actividades`, `PATCH actividades/[id]` | Según matriz | R-40, R-41. Asistencia no crea ni lee `es_juridica` |
| `PATCH solicitudes/[id]/expediente` | D, C, titular | |
| `GET notificaciones`, `POST notificaciones/[id]/leida` | Cada quien, las suyas | |

### Entrega 5
| Ruta | Quién | Notas |
|---|---|---|
| `GET tablero` (completo) | D, C; asociado lo suyo | Casos por estado, vencimientos, objetivos incumplidos, carga |
| `GET reportes` | D, C | Por período, área, canal, responsable: solicitudes, contactos nuevos y duplicados, consultas agendadas vs. atendidas, propuestas y contrataciones, tiempos de primera respuesta y de asignación, tareas vencidas, motivos de descarte. Cierre no equivale a éxito: muestra `resultado_cierre` |
| `GET exportar` | D, C | Período obligatorio. CSV UTF-8 con BOM. Antepone `'` a celdas que empiecen con `=`, `+`, `-` o `@`. Excluye reservados para coordinación. R-54 |
| `GET`, `POST`, `DELETE turnos` | D, C | |

### 8.1 Quién puede hacer cada cambio de estado (`lib/crm/estados.ts`)

| Cambio | Quién |
|---|---|
| Hacia `en_calificacion`, `pendiente_informacion`, `consulta_agendada`, `propuesta_enviada`, `pendiente_aceptacion` | D, C, A |
| `pendiente_aceptacion → aceptada_pendiente_asignacion` | Dirección (exige conflicto `sin_conflicto`) |
| Hacia `descartada` | Dirección; además C y A solo si la solicitud está `nueva` con `requiere_validacion = true` |
| `asignada`, `en_curso` desde `asignada`, y vuelta a pendiente de asignación | Nunca por esta ruta: solo mediante las funciones de asignación |
| `en_curso ↔ en_espera`, `→ cerrada` | D, C, titular activo |
| Reaperturas | Dirección |

Después de todo cambio de estado: recalcula la etapa del contacto (10.3), aplica R-19 si corresponde y envía los avisos.

---

## 9. Interfaz

### 9.1 Estilo
Usa lo que ya existe en el panel: `bg-primary`, `bg-card-bg`, `border-border`, `text-gold`, `text-text-muted`, `text-text-light`, `font-cinzel` para títulos, `font-montserrat` para el resto, etiquetas `text-[10px] uppercase tracking-widest`, iconos de `lucide-react`. Sin librerías de componentes nuevas. `CRM_maqueta_listado.html` es la referencia visual y de comportamiento (sus colores son aproximados: usa los tokens reales del proyecto).

### 9.2 Estructura
- `app/admin/layout.tsx` hoy envuelve todo `/admin` con `AdminNav`. Para rutas que empiecen con `/admin/crm` debe mostrar el armazón del CRM (`CrmNav` + `CrmTopBar`) en lugar de `AdminNav`.
- **`CrmNav`:** misma apariencia que `AdminNav` (ancho `w-56`, fondo `#060b12`). Marca **centrada**: "CRM" sobre "IMPERIUM IURIS". Secciones agrupadas con contador de pendientes; cada rol ve solo las suyas (9.6). Dirección ve además un enlace "Panel Admin".
- **`CrmTopBar`:** ubicación a la izquierda; a la derecha nombre del usuario, su rol y botón de salir.
- **Entradas:** opción **"CRM"** en el menú desplegable de usuario del sitio público (junto a "Panel Admin"), visible para todo el personal activo; y un ítem "CRM" en `AdminNav`. Un asociado ve "CRM" pero no "Panel Admin" ni "Modo edición".

### 9.3 Patrón de listado (`ListaSeleccionable`) — obligatorio en todos los listados
1. Título y botón principal ("+ Nueva solicitud") arriba a la derecha.
2. Buscador y filtros. El buscador espera ~250 ms tras la última tecla, ignora tildes y mayúsculas, consulta al servidor y se combina con los filtros. Sin resultados: mensaje claro.
3. Barra de acciones: "Ninguna solicitud seleccionada" con botones deshabilitados. Al seleccionar una fila se resalta, la barra muestra cuál es y se habilitan los botones. Volver a hacer clic la deselecciona.
4. Solo se muestran los botones que el rol puede usar. **No existe "Eliminar".**
5. **Carga progresiva:** 30 filas por lote; al acercarse al final se trae el siguiente. Sin paginación numerada. Pie: "Mostrando 60 de 214 solicitudes".
6. **Parte superior fija:** título, buscador, filtros, barra de acciones y encabezados de la tabla no se desplazan; solo se desplaza el cuerpo de la lista. En pantallas angostas (< 820 px) la página se desplaza completa.
7. **Columnas de ancho fijo** (`table-layout: fixed` con anchos por columna): la tabla no se reacomoda al buscar o filtrar. El texto que no cabe se corta con puntos suspensivos y se ve completo en el `title`.
8. Teclado: filas enfocables, Enter o Espacio seleccionan; foco visible. Cambiar la búsqueda o un filtro limpia la selección.

Acciones del listado de solicitudes: **Ver, Editar, Cambiar estado**. Agendar cita no va en el listado: se hace desde el detalle de la solicitud o desde la Agenda.

### 9.4 Formularios — sin ventanas flotantes
**Prohibido:** modales, diálogos, popovers con formularios y `window.confirm`.
- **Formularios largos:** página propia (`/nueva`, `/[id]/editar`) con "Volver" que conserva búsqueda y filtros del listado (guárdalos en la URL).
- **Acciones cortas** (1 a 3 campos: cambiar estado, cancelar cita, rechazar asignación, completar tarea): `PanelAccion` que se despliega dentro de la página bajo la barra de acciones, con Guardar y Cancelar. Al abrirse recibe el foco.
- **Acciones delicadas** (cerrar, descartar, fusionar, desactivar usuario): el mismo panel, con motivo obligatorio y un resumen de lo que va a ocurrir.
- **Resultado:** franja dentro de la página (éxito o error). **Errores de validación:** junto a cada campo.
- "Cambiar estado" ofrece **solo** los estados permitidos desde el actual y para el rol, y muestra el campo de motivo cuando la regla lo exige.

### 9.5 Indicadores (`Indicador`) — sin píldoras de colores
Texto normal con un marcador pequeño. Paleta limitada a los tonos del sitio; el rojo se reserva para lo crítico.
- **Urgencia** (cuadrado): crítica = relleno rojo y texto resaltado · alta = relleno dorado · media = contorno dorado · ordinaria = sin marcador, texto atenuado.
- **Estado** (punto, por fase): por atender (`nueva`) = contorno · en trámite (calificación a pendiente de asignación) = dorado · activo (`asignada`, `en_curso`, `en_espera`) = claro · terminado (`cerrada`, `descartada`) = atenuado.
- El significado nunca depende solo del color: el texto siempre está.

### 9.6 Pantallas (`/admin/crm/…`)

| Pantalla | Ruta | Quién | Entrega |
|---|---|---|---|
| Tablero | `/` | Todos (cada quien lo suyo) | 1 / 5 |
| Usuarios | `/usuarios`, `/usuarios/nuevo`, `/usuarios/[id]/editar` | Dirección | 1 |
| Historial | `/bitacora` | Dirección | 1 |
| Solicitudes | `/solicitudes` | D, C, A; asociado y externo sus casos | 2 |
| Nueva solicitud | `/solicitudes/nueva` | D, C, A | 2 |
| Detalle de solicitud | `/solicitudes/[id]` con pestañas en la URL: `resumen`, `equipo`, `cronologia`, `citas`, `expediente`, `historial` | Según 4.2 | 2–4 |
| Contactos | `/contactos`, `/contactos/nuevo`, `/contactos/[id]`, `/contactos/[id]/editar` | D, C, A; asociado los de sus casos | 2 |
| Validación | `/validacion` | D, C, A | 2 |
| Duplicados | `/duplicados`, `/duplicados/[id]` (dos fichas lado a lado; se elige cuál se conserva) | D, C, A (fusiona D, C) | 2 |
| Asignar equipo | `/solicitudes/[id]/equipo/proponer` | D, C | 3 |
| Mis asignaciones | `/asignaciones` | Asociado, externo | 3 |
| Personal | `/personal`, `/personal/[id]`, `/personal/[id]/editar` | D, C; cada quien su ficha | 3 |
| Agenda | `/agenda` (semana por abogado) | D, C, A; asociado la suya | 4 |
| Agendar / reagendar | `/citas/nueva?solicitud=…`, `/citas/[id]/reagendar` | Quien puede agendar | 4 |
| Horario | `/personal/[id]/horario` | Dirección edita; C, A y el propio abogado lo ven | 4 |
| Tareas | `/tareas`, `/tareas/nueva` | Todos (las propias o las de sus casos) | 4 |
| Reportes | `/reportes` | D, C | 5 |
| Turnos | `/turnos` | D, C | 5 |

Detalles:
- **Nueva solicitud:** paso 1, buscar el contacto o crearlo en la misma página; paso 2, datos del pedido. Antes de crear un contacto se muestran las coincidencias.
- **Agendar cita:** se elige abogado → día → hora. Los días sin cupo aparecen deshabilitados con "Sin disponibilidad"; del día elegido solo se muestran, como botones, las horas libres. Ante un 409 se muestra "Esa hora acaba de ocuparse", se refrescan las horas y **no se pierde** lo ya escrito.
- **Asignar equipo:** lista de sugerencias con carga/capacidad; aviso visible si la persona está en su límite.
- **Caso cerrado:** franja "Caso cerrado — solo lectura", sin botones de edición.
- **Reserva reforzada:** marca visible para quien puede verlo.
- **Estados vacíos:** cada listado explica el siguiente paso.
- **Accesibilidad:** etiquetas en todos los campos, foco visible, `aria-live` en la barra de selección y en los mensajes, contraste suficiente, respeto a `prefers-reduced-motion`.

---

## 10. Ingreso automático y contrato para otros módulos

### 10.1 `registrarEntrada()` (`lib/crm/ingesta.ts`)

```ts
type Entrada = {
  canal: 'web' | 'cita' | 'chat' | 'correo' | 'whatsapp' | 'llamada' | 'presencial' | 'referido'
  origen?: { tabla: 'consultas' | 'citas' | 'mensajes' | 'ia'; id: string }
  contacto: { nombres: string; apellidos?: string; correo?: string; telefono?: string;
              tipoIdentificacion?: string; identificacion?: string }
  descripcion: string
  areaId?: string; servicioId?: string
  urgencia?: 'critica' | 'alta' | 'media' | 'ordinaria'
  sospechoso?: boolean          // → requiere_validacion = true
}
type Resultado = { ok: true; contactoId: string; solicitudId: string; codigo: string }
               | { ok: false; motivo: string }
```

Comportamiento:
1. **Contacto:** con identificación → busca la ficha vigente por tipo y número. Sin identificación → si teléfono **y** correo normalizados coinciden con **una única** ficha vigente, la reutiliza; si coincide solo uno o hay varias, crea una ficha nueva y registra el posible duplicado (R-04). Nunca sobrescribe datos de una ficha existente.
2. **Solicitud:** la crea en `nueva`. Si ya existe una con el mismo origen, devuelve esa.
3. Si el origen es una cita, guarda el `solicitud_id` en la cita.
4. Registra en la bitácora con `user_id = null` (acción automática) y aplica R-16.
5. **Nunca lanza excepciones:** devuelve `{ ok: false }` y deja el error en el log del servidor (sin datos personales).

### 10.2 Dónde se llama
- `app/api/contact/route.ts` y `app/api/appointments/route.ts`: **después** de guardar con éxito y sin `await` bloqueante que pueda romper la respuesta. Si falla, el formulario se envía igual.
- E1 y E3 usarán esta misma función. No construyas su webhook.

### 10.3 Etapa de relación del contacto (`lib/crm/etapas.ts`)
Se recalcula tras cada cambio de estado, tomando la más avanzada entre sus solicitudes:
`asignada`/`en_curso`/`en_espera` → `cliente_activo` · `propuesta_enviada`/`pendiente_aceptacion`/`aceptada_pendiente_asignacion` → `propuesta_enviada` · `consulta_agendada` → `consulta_agendada` · `en_calificacion`/`pendiente_informacion` → `prospecto_calificado` · `nueva` → `prospecto_nuevo` · solo cerradas → `cliente_inactivo`.
`no_continua` se pone a mano con motivo y no se sobrescribe, salvo que llegue una solicitud nueva.

---

## 11. Disponibilidad y avisos

### 11.1 Horas libres (`lib/crm/disponibilidad.ts`)
Para un abogado, un rango de fechas y una duración:
1. Toma las franjas de `crm_horarios` de cada día (`dia_semana` ISO: 1 = lunes … 7 = domingo).
2. Genera inicios cada 30 min (constante en `config.ts`) cuyo intervalo `[inicio, inicio + duración)` quepa entero en una franja.
3. Descarta los que se crucen con un bloqueo o con una cita activa de ese abogado.
4. Descarta los que empiecen antes de `ahora + antelación mínima` (60 min, constante).
5. Devuelve por día `{ fecha, horas: string[] }`; un día con `horas` vacío se muestra deshabilitado.
6. Si el abogado no tiene ninguna franja en `crm_horarios`, el selector no muestra un calendario vacío: indica "Este abogado aún no tiene horario configurado" y, a Dirección, el enlace a su pantalla de horario.

`POST citas` y el reagendado **repiten esta comprobación** al guardar; la restricción de la base cubre la carrera entre dos personas.

### 11.2 Avisos (`lib/crm/avisos.ts`)
- Cada aviso se inserta en `crm_notificaciones` y luego se intenta enviar; se actualiza a `enviada` o `fallida` (con `ultimo_error` e `intentos`).
- Canales: `panel` (siempre, para el personal), `correo` (Resend, patrón existente), `push` (lib existente). WhatsApp no.
- Se envían **después** de completar la acción y nunca la deshacen.
- El título no lleva datos sensibles: "Nueva asignación en S26-0041", no el nombre del cliente.
- Para casos con reserva reforzada, solo a personas autorizadas.
- Eventos: solicitud crítica, asignación por confirmar, asignación rechazada, cita agendada / reagendada / cancelada, tarea asignada, bloqueo con citas afectadas.
- Los recordatorios programados son del E7: no crees tareas cron.

---

## 12. Cambios en archivos existentes

Haz solo lo indicado, en commits separados, y descríbelos en el PR para que los revise el responsable:

| Archivo | Cambio |
|---|---|
| `middleware.ts` | Permitir `/admin/crm/**` a usuarios con `app_metadata.role` en `admin`, `coordinacion`, `asistencia`, `asociado`, `externo`. El resto de `/admin/**` sigue siendo solo para admin |
| `lib/admin-auth.ts` | Sin cambios de comportamiento. Si necesitas algo, agrégalo en `lib/crm/permisos.ts` |
| `app/admin/layout.tsx` | Armazón del CRM para rutas `/admin/crm` |
| `components/admin/AdminNav.tsx` | Ítem "CRM" |
| Menú desplegable de usuario del sitio | Opción "CRM" para el personal |
| `app/api/contact/route.ts`, `app/api/appointments/route.ts` | Llamada a `registrarEntrada()`. En appointments, un `23505` de `citas_un_turno_sin_abogado` responde 409 "Horario no disponible" |
| Pantalla y ruta actuales de administración de citas | La cancelación pide motivo y usa `crm_cancelar_cita`; no se ofrece reactivar una cita cancelada (R-38) |
| `CLAUDE.md` | Sección breve sobre el CRM: rutas, capa de permisos y convenciones |

Estos cambios dependen de que M4 y M5 estén aplicadas. **No los fusiones antes.**

---

## 13. Seguridad

- Ningún archivo de `lib/crm` se importa desde componentes cliente (usan `service_role`).
- Nunca devuelvas `error.message` de Supabase al navegador.
- Los logs del servidor no llevan datos personales ni contenido de notas.
- Toda entrada pasa por Zod; todo identificador es UUID validado.
- No construyas filtros concatenando texto del usuario sin escapar.
- Devuelve al cliente solo las columnas que la pantalla necesita, ya filtradas por rol (no envíes notas jurídicas a asistencia y las ocultes en la interfaz).
- Si las rutas admin existentes verifican el origen de la petición, las del CRM hacen lo mismo.

---

## 14. Criterios de aceptación

Para cada entrega: `npx tsc --noEmit`, lint y `npm run build` sin errores, y esta lista verificada a mano.

**Entrega 1**
- [ ] Un asociado ve "CRM" en el menú del sitio, no "Panel Admin"; entra a `/admin/crm` y es rechazado en `/admin/blog`.
- [ ] Dirección crea un usuario de asistencia; ese usuario entra y ve solo sus secciones.
- [ ] Desactivar a un usuario le corta el acceso en su siguiente petición.
- [ ] No se puede desactivar ni degradar a la última Dirección, ni la propia cuenta.
- [ ] Cada acción anterior aparece en el Historial.

**Entrega 2**
- [ ] Cédula inválida se rechaza junto al campo; RUC con dígito no verificable se acepta como "no validado".
- [ ] Crear un contacto con un correo existente muestra la coincidencia antes de guardar y, si se confirma, aparece en Duplicados.
- [ ] Fusionar mueve solicitudes y actividades y deja la otra ficha como fusionada.
- [ ] Enviar el formulario web crea contacto y solicitud `nueva`; reenviarlo no la duplica; si `registrarEntrada` falla, el formulario se envía igual.
- [ ] "Cambiar estado" ofrece solo los estados permitidos y exige motivo al descartar.
- [ ] El listado cumple 9.3: selección, buscador sin tildes, carga progresiva, parte superior fija, columnas que no se mueven al buscar.
- [ ] Un asociado no encuentra en el buscador casos que no son suyos.

**Entrega 3**
- [ ] No se puede aceptar un encargo sin revisión de conflictos; con conflicto solo se puede descartar.
- [ ] Proponer → aprobar → confirmar lleva el caso a `en_curso`; rechazar lo devuelve a pendiente de asignación con motivo.
- [ ] Aprobar a alguien en su límite pide motivo; con motivo queda registrado como autorización.
- [ ] Solo la persona asignada puede confirmar.
- [ ] El suplente en reserva no ve el caso hasta que se le activa.

**Entrega 4**
- [ ] Dirección configura el horario de un abogado y el selector ofrece solo esas horas; los demás roles no pueden editarlo.
- [ ] El selector no muestra horas ocupadas, bloqueadas ni fuera de horario; los días sin cupo están deshabilitados.
- [ ] Dos navegadores reservando la misma hora: el segundo recibe "esa hora acaba de ocuparse" con las horas actualizadas y sin perder lo escrito.
- [ ] Cancelar pide motivo, libera la hora, devuelve el caso a calificación y crea la tarea de reagendar.
- [ ] Una cita cancelada no se puede reactivar.
- [ ] Asistencia no ve notas jurídicas (comprobado en la respuesta de la API, no solo en pantalla).
- [ ] No se cierra un caso con citas futuras ni, sin justificarlo, con tareas pendientes.

**Entrega 5**
- [ ] El tablero de un asociado muestra solo lo suyo.
- [ ] Coordinación no ve casos reservados en reportes ni exportaciones.
- [ ] Cada exportación queda en el Historial con sus filtros.

**En todas:** ningún formulario flotante; ninguna tabla `crm_*` consultada desde el navegador; ningún permiso decidido fuera de `lib/crm/permisos.ts`.

---

## 15. Decisiones tomadas y pendientes

**Tomadas (no las cambies sin consultar):** Dirección equivale a `admin`; los casos en espera cuentan en la carga; el titular puede cerrar su caso; los casos cerrados los ven Dirección, coordinación y el titular; la reserva web entra sin abogado y el personal lo asigna desde el CRM; la consulta dura 60 min; el horario de cada abogado lo configura Dirección desde el CRM; un RUC con dígito verificador que no cuadra se acepta como "no validado"; el usuario nuevo recibe una invitación por correo y define su contraseña.

**Pendientes de confirmar con personas — si te bloquean, pregunta:**
- Autorización del responsable para aplicar M4 y M5, y coordinación con E2 y E7 por los cambios a `citas`.
- Que el proyecto Supabase tenga configurado el envío de correos de invitación.
- Horas hábiles para medir los objetivos de atención (se asume lunes a viernes, 09:00–18:00).
