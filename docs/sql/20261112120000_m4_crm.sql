-- ════════════════════════════════════════════════════════════════════════════
-- M4 — Módulo E6 Mini-CRM  (versión 2 · BORRADOR PARA REVISIÓN)
-- ════════════════════════════════════════════════════════════════════════════
-- Crea 17 tablas, 1 vista y las funciones/triggers del CRM, todo con prefijo
-- crm_. NO modifica ninguna tabla de otros módulos (eso lo hace M5, aparte).
--
-- PRINCIPIOS DE ESTE SCRIPT
--   1. Las reglas críticas las impone la base (CHECK, UNIQUE, EXCLUDE, FK y
--      triggers). El servidor valida antes para dar mensajes claros, pero la
--      base es la última barrera. Cada regla lleva su código (R-xx) y los
--      triggers lo incluyen en el mensaje de error: 'CRM-R12: ...'.
--   2. Misma convención de seguridad que M1–M3 y que el catálogo E5:
--      RLS activado SIN políticas, REVOKE ALL y GRANT mínimo a service_role.
--      El navegador nunca consulta estas tablas; la autorización por rol y
--      por caso se aplica en el servidor (lib/crm/permisos.ts).
--   3. Nada se borra: fichas, casos y actividades no tienen permiso DELETE y
--      las claves foráneas no usan ON DELETE CASCADE sobre datos de negocio.
--   4. El historial (crm_bitacora, crm_solicitud_estados, crm_reasignaciones)
--      es de solo inserción.
--   5. Las operaciones de varios pasos que deben ser atómicas son funciones
--      (crm_fusionar_contactos, crm_aprobar_asignacion,
--      crm_responder_asignacion, crm_reasignar_titular; crm_cancelar_cita en M5).
--   6. Todas las funciones fijan search_path = '' y usan nombres calificados.
--
-- DEPENDENCIAS (la comprobación previa aborta si falta alguna)
--   · M1: public.set_updated_at(), public.citas
--   · Catálogo E5: public.areas_practica, public.servicios
--   · Extensión btree_gist (para impedir franjas de horario solapadas)
--
-- NO EJECUTAR EN EL SUPABASE DEV COMPARTIDO SIN AUTORIZACIÓN DEL RESPONSABLE.
-- Ejecuta el archivo COMPLETO. Si la sesión queda abortada: ROLLBACK;
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── Comprobación previa ────────────────────────────────────────────────────
do $$
declare
  existentes text;
begin
  if pg_catalog.to_regprocedure('public.set_updated_at()') is null then
    raise exception 'M4 ABORTADA: falta public.set_updated_at(). Aplica M1 primero.';
  end if;
  if pg_catalog.to_regclass('public.citas') is null then
    raise exception 'M4 ABORTADA: falta public.citas. Aplica M1 primero.';
  end if;
  if pg_catalog.to_regclass('public.areas_practica') is null
     or pg_catalog.to_regclass('public.servicios') is null then
    raise exception 'M4 ABORTADA: falta el catálogo E5 (areas_practica, servicios).';
  end if;

  select string_agg(c.relname::text, ', ' order by c.relname)
    into existentes
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'crm\_%';
  if existentes is not null then
    raise exception 'M4 ABORTADA: ya existen objetos crm_ en public: %', existentes;
  end if;
end
$$;

create extension if not exists btree_gist with schema extensions;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. PERSONAL (toda persona del estudio que usa el CRM)
-- ════════════════════════════════════════════════════════════════════════════
-- ESTA TABLA ES LA FUENTE DE VERDAD DEL ROL. El servidor la consulta en cada
-- petición, por eso desactivar a alguien surte efecto de inmediato.
-- app_metadata.role del usuario es solo un espejo para el middleware.
-- user_id puede ser null: la ficha puede existir antes que la cuenta.
create table public.crm_personal (
  id                         uuid        not null default gen_random_uuid(),
  user_id                    uuid,
  rol                        text        not null,
  nombres                    text        not null,
  apellidos                  text        not null,
  identificacion             text,
  correo                     text,
  telefono                   text,
  ciudad                     text,
  -- Datos profesionales
  es_abogado                 boolean     not null default false,
  matricula                  text,
  habilitacion_verificada    boolean     not null default false,
  habilitacion_verificada_at timestamptz,
  especialidad               text,             -- peritos y colaboradores externos
  capacidad_maxima           integer,          -- casos como titular; null = sin límite definido
  fecha_vinculacion          date,
  acuerdo_confidencialidad   boolean     not null default false,
  acuerdo_confidencialidad_at date,
  activo                     boolean     not null default true,
  created_by                 uuid,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint crm_personal_pkey primary key (id),
  constraint crm_personal_user_id_key unique (user_id),
  constraint crm_personal_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null,
  constraint crm_personal_rol_check
    check (rol in ('direccion', 'coordinacion', 'asistencia', 'asociado', 'externo')),
  constraint crm_personal_nombres_check
    check (btrim(nombres) <> '' and btrim(apellidos) <> ''),
  constraint crm_personal_capacidad_check
    check (capacidad_maxima is null or capacidad_maxima > 0),
  -- Un asociado es, por definición, abogado. Un externo no lleva patrocinio.
  constraint crm_personal_asociado_check check (rol <> 'asociado' or es_abogado),
  constraint crm_personal_externo_check  check (rol <> 'externo' or not es_abogado),
  -- No se puede dar por verificada una habilitación sin matrícula.
  constraint crm_personal_habilitacion_check check (
    not habilitacion_verificada
    or (es_abogado and matricula is not null and btrim(matricula) <> ''))
);

create index crm_personal_rol_idx on public.crm_personal (rol) where activo;

-- R-55: siempre debe quedar al menos una cuenta de Dirección activa.
create function public.crm_personal_reglas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.rol = 'direccion' and old.activo
     and (new.rol <> 'direccion' or not new.activo) then
    perform 1 from public.crm_personal
      where rol = 'direccion' and activo and id <> old.id
      for update;
    if not found then
      raise exception 'CRM-R55: debe quedar al menos una cuenta de Dirección activa';
    end if;
  end if;
  if new.habilitacion_verificada and not old.habilitacion_verificada
     and new.habilitacion_verificada_at is null then
    new.habilitacion_verificada_at := now();
  end if;
  return new;
end;
$$;

create trigger crm_personal_reglas
  before update on public.crm_personal
  for each row execute function public.crm_personal_reglas();

-- R-28: titular y suplente DE REFERENCIA por área. No da acceso a expedientes.
create table public.crm_personal_areas (
  personal_id            uuid    not null,
  area_id                uuid    not null,
  rol_referencia         text    not null default 'miembro',
  competencia_acreditada boolean not null default false,
  created_at             timestamptz not null default now(),
  constraint crm_personal_areas_pkey primary key (personal_id, area_id),
  constraint crm_personal_areas_personal_fkey
    foreign key (personal_id) references public.crm_personal (id),
  constraint crm_personal_areas_area_fkey
    foreign key (area_id) references public.areas_practica (id),
  constraint crm_personal_areas_rol_check
    check (rol_referencia in ('titular', 'suplente', 'miembro'))
);

create unique index crm_personal_areas_un_titular
  on public.crm_personal_areas (area_id) where rol_referencia = 'titular';
create unique index crm_personal_areas_un_suplente
  on public.crm_personal_areas (area_id) where rol_referencia = 'suplente';

create function public.crm_personal_areas_reglas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.crm_personal p
                  where p.id = new.personal_id and p.es_abogado and p.activo) then
    raise exception 'CRM-R28: solo un abogado activo puede vincularse a un área';
  end if;
  return new;
end;
$$;

create trigger crm_personal_areas_reglas
  before insert or update on public.crm_personal_areas
  for each row execute function public.crm_personal_areas_reglas();

-- ════════════════════════════════════════════════════════════════════════════
-- 2. AGENDA DEL PERSONAL (horario semanal, bloqueos y turnos)
-- ════════════════════════════════════════════════════════════════════════════
-- R-32: horario de atención. dia_semana ISO: 1 = lunes … 7 = domingo.
-- Las horas son hora local de Guayaquil (sin cambio de horario).
create table public.crm_horarios (
  id          uuid     not null default gen_random_uuid(),
  personal_id uuid     not null,
  dia_semana  smallint not null,
  hora_inicio time without time zone not null,
  hora_fin    time without time zone not null,
  created_at  timestamptz not null default now(),
  constraint crm_horarios_pkey primary key (id),
  constraint crm_horarios_personal_fkey
    foreign key (personal_id) references public.crm_personal (id),
  constraint crm_horarios_dia_check check (dia_semana between 1 and 7),
  constraint crm_horarios_rango_check check (hora_fin > hora_inicio),   -- R-36
  -- Dos franjas de la misma persona y día no pueden solaparse.
  constraint crm_horarios_sin_solape exclude using gist (
    personal_id with =,
    dia_semana  with =,
    tsrange(date '2000-01-01' + hora_inicio, date '2000-01-01' + hora_fin) with &&)
);

-- Períodos en que la persona no atiende (vacaciones, audiencias, permisos).
create table public.crm_bloqueos (
  id          uuid        not null default gen_random_uuid(),
  personal_id uuid        not null,
  desde       timestamptz not null,
  hasta       timestamptz not null,
  tipo        text        not null default 'otro',
  motivo      text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  constraint crm_bloqueos_pkey primary key (id),
  constraint crm_bloqueos_personal_fkey
    foreign key (personal_id) references public.crm_personal (id),
  constraint crm_bloqueos_tipo_check
    check (tipo in ('vacaciones', 'audiencia', 'permiso', 'otro')),
  constraint crm_bloqueos_rango_check check (hasta > desde)             -- R-36
);

create index crm_bloqueos_personal_idx on public.crm_bloqueos (personal_id, desde, hasta);

-- Abogados de turno fuera de horario (semana, fin de semana, feriado).
create table public.crm_turnos (
  id          uuid        not null default gen_random_uuid(),
  personal_id uuid        not null,
  desde       timestamptz not null,
  hasta       timestamptz not null,
  tipo        text        not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  constraint crm_turnos_pkey primary key (id),
  constraint crm_turnos_personal_fkey
    foreign key (personal_id) references public.crm_personal (id),
  constraint crm_turnos_tipo_check check (tipo in ('semana', 'fin_de_semana', 'feriado')),
  constraint crm_turnos_rango_check check (hasta > desde)               -- R-36
);

create index crm_turnos_rango_idx on public.crm_turnos (desde, hasta);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. CONTACTOS (personas y empresas)
-- ════════════════════════════════════════════════════════════════════════════
create table public.crm_contactos (
  id                        uuid        not null default gen_random_uuid(),
  tipo                      text        not null default 'persona',
  -- Persona
  nombres                   text,
  apellidos                 text,
  ocupacion                 text,
  -- Empresa
  razon_social              text,
  nombre_comercial          text,
  sector                    text,
  -- Identificación (criterio principal contra duplicados)
  tipo_identificacion       text,
  identificacion            text,
  identificacion_validada   boolean     not null default false,  -- dígito verificador (servidor)
  -- Contacto
  telefono                  text,
  telefono_normalizado      text,       -- E.164 (+593…), lo calcula el servidor
  correo                    text,
  correo_normalizado        text generated always as (lower(btrim(correo))) stored,
  -- Texto para el buscador: minúsculas y sin tildes ("Peña" se encuentra con "pena").
  busqueda                  text generated always as (
    translate(lower(
      coalesce(nombres, '') || ' ' || coalesce(apellidos, '') || ' ' ||
      coalesce(razon_social, '') || ' ' || coalesce(nombre_comercial, '') || ' ' ||
      coalesce(identificacion, '') || ' ' || coalesce(telefono, '') || ' ' ||
      coalesce(correo, '')),
      'áéíóúüñàèìòù', 'aeiouunaeiou')) stored,
  ciudad                    text,
  direccion                 text,
  preferencia_comunicacion  text,
  acepta_comunicaciones_comerciales boolean not null default false,
  -- Relación comercial (independiente del estado de cada solicitud)
  etapa_relacion            text        not null default 'prospecto_nuevo',
  motivo_no_continua        text,
  canal_primer_contacto     text,
  como_nos_conocio          text,
  notas_internas            text,
  -- Confidencialidad y ciclo de vida
  reserva_reforzada         boolean     not null default false,
  user_id                   uuid,       -- cuenta del portal de clientes, si existe
  fusionado_en              uuid,       -- ficha que sobrevive tras una fusión
  archivado_at              timestamptz,
  created_by                uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint crm_contactos_pkey primary key (id),
  constraint crm_contactos_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null,
  constraint crm_contactos_fusionado_fkey
    foreign key (fusionado_en) references public.crm_contactos (id),
  constraint crm_contactos_fusionado_check check (fusionado_en is null or fusionado_en <> id),
  constraint crm_contactos_tipo_check check (tipo in ('persona', 'empresa')),
  -- R-01
  constraint crm_contactos_datos_minimos_check check (
    (tipo = 'persona' and nombres is not null and btrim(nombres) <> '') or
    (tipo = 'empresa' and razon_social is not null and btrim(razon_social) <> '')),
  constraint crm_contactos_tipo_identificacion_check check (
    tipo_identificacion is null or
    tipo_identificacion in ('cedula', 'pasaporte', 'ruc', 'extranjera')),
  constraint crm_contactos_identificacion_par_check check (
    (tipo_identificacion is null) = (identificacion is null)),
  -- R-03 (formato; el dígito verificador lo valida el servidor)
  constraint crm_contactos_identificacion_formato_check check (
    identificacion is null
    or (tipo_identificacion = 'cedula' and identificacion ~ '^[0-9]{10}$')
    or (tipo_identificacion = 'ruc'    and identificacion ~ '^[0-9]{13}$')
    or (tipo_identificacion in ('pasaporte', 'extranjera')
        and identificacion ~ '^[A-Z0-9-]{4,20}$')),
  constraint crm_contactos_empresa_identificacion_check check (
    tipo <> 'empresa' or tipo_identificacion is null
    or tipo_identificacion in ('ruc', 'extranjera')),
  constraint crm_contactos_telefono_check check (
    telefono_normalizado is null or telefono_normalizado ~ '^\+[1-9][0-9]{7,14}$'),
  constraint crm_contactos_correo_check check (
    correo is null or btrim(correo) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint crm_contactos_preferencia_check check (
    preferencia_comunicacion is null or
    preferencia_comunicacion in ('whatsapp', 'correo', 'llamada')),
  constraint crm_contactos_etapa_check check (etapa_relacion in (
    'prospecto_nuevo', 'prospecto_calificado', 'consulta_agendada',
    'propuesta_enviada', 'cliente_activo', 'cliente_inactivo', 'no_continua')),
  -- R-06
  constraint crm_contactos_motivo_no_continua_check check (
    etapa_relacion <> 'no_continua'
    or (motivo_no_continua is not null and btrim(motivo_no_continua) <> '')),
  constraint crm_contactos_canal_check check (canal_primer_contacto is null or
    canal_primer_contacto in ('web', 'cita', 'chat', 'correo', 'whatsapp',
                              'llamada', 'presencial', 'referido'))
);

-- R-02: la identificación es única entre fichas vigentes (no fusionadas).
create unique index crm_contactos_identificacion_key
  on public.crm_contactos (tipo_identificacion, identificacion)
  where identificacion is not null and fusionado_en is null;
-- R-04: teléfono y correo NO son únicos; se indexan para proponer revisión.
create index crm_contactos_telefono_idx on public.crm_contactos (telefono_normalizado);
create index crm_contactos_correo_idx   on public.crm_contactos (correo_normalizado);
create index crm_contactos_etapa_idx    on public.crm_contactos (etapa_relacion);

-- R-07: personas de contacto de una empresa.
create table public.crm_contacto_vinculos (
  empresa_id               uuid    not null,
  persona_id               uuid    not null,
  cargo                    text,
  es_representante_legal   boolean not null default false,
  documento_representacion text,
  created_at               timestamptz not null default now(),
  constraint crm_contacto_vinculos_pkey primary key (empresa_id, persona_id),
  constraint crm_contacto_vinculos_empresa_fkey
    foreign key (empresa_id) references public.crm_contactos (id),
  constraint crm_contacto_vinculos_persona_fkey
    foreign key (persona_id) references public.crm_contactos (id)
);

create index crm_contacto_vinculos_persona_idx on public.crm_contacto_vinculos (persona_id);

create function public.crm_contacto_vinculos_reglas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.crm_contactos c
                  where c.id = new.empresa_id and c.tipo = 'empresa') then
    raise exception 'CRM-R07: empresa_id debe ser un contacto de tipo empresa';
  end if;
  if not exists (select 1 from public.crm_contactos c
                  where c.id = new.persona_id and c.tipo = 'persona') then
    raise exception 'CRM-R07: persona_id debe ser un contacto de tipo persona';
  end if;
  return new;
end;
$$;

create trigger crm_contacto_vinculos_reglas
  before insert or update on public.crm_contacto_vinculos
  for each row execute function public.crm_contacto_vinculos_reglas();

-- R-04/R-05: posibles duplicados; los resuelve siempre una persona.
create table public.crm_posibles_duplicados (
  id           uuid        not null default gen_random_uuid(),
  contacto_a   uuid        not null,
  contacto_b   uuid        not null,
  coincidencia text        not null,
  estado       text        not null default 'pendiente',
  resuelto_por uuid,
  resuelto_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint crm_posibles_duplicados_pkey primary key (id),
  constraint crm_posibles_duplicados_a_fkey
    foreign key (contacto_a) references public.crm_contactos (id),
  constraint crm_posibles_duplicados_b_fkey
    foreign key (contacto_b) references public.crm_contactos (id),
  constraint crm_posibles_duplicados_par_key unique (contacto_a, contacto_b),
  constraint crm_posibles_duplicados_orden_check check (contacto_a < contacto_b),
  constraint crm_posibles_duplicados_coincidencia_check
    check (coincidencia in ('telefono', 'correo', 'nombre')),
  constraint crm_posibles_duplicados_estado_check
    check (estado in ('pendiente', 'fusionado', 'descartado')),
  constraint crm_posibles_duplicados_resuelto_check
    check (estado = 'pendiente' or resuelto_at is not null)
);

create index crm_posibles_duplicados_b_idx on public.crm_posibles_duplicados (contacto_b);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. SOLICITUDES (cada pedido de ayuda; es "caso" desde que se acepta)
-- ════════════════════════════════════════════════════════════════════════════
create sequence public.crm_solicitud_codigo_seq;

create table public.crm_solicitudes (
  id                     uuid        not null default gen_random_uuid(),
  -- R-10: lo asigna el trigger crm_solicitudes_reglas con el formato S26-0041
  -- (S + año de 2 dígitos + número corrido que nunca se reinicia ni se trunca).
  codigo                 text        not null default '',
  contacto_id            uuid        not null,
  empresa_id             uuid,                 -- si actúa en nombre de una empresa
  canal_origen           text        not null,
  origen_tabla           text,                 -- consultas · citas · mensajes · ia
  origen_id              uuid,
  area_principal_id      uuid,
  servicio_id            uuid,
  descripcion            text        not null,
  objetivo_cliente       text,
  modalidad              text,
  urgencia               text        not null default 'ordinaria',
  -- Estado y su trazabilidad
  estado                 text        not null default 'nueva',
  motivo_estado          text,
  estado_por             uuid,                 -- usuario que hizo el último cambio; null = automático
  estado_at              timestamptz not null default now(),
  -- R-20/R-21: revisión de conflictos de interés. Sin resultado "sin conflicto"
  -- el encargo no se acepta ni se asigna; con conflicto solo cabe descartarlo.
  conflicto_revision     text        not null default 'pendiente',
  conflicto_detalle      text,
  conflicto_revisado_por uuid,
  conflicto_revisado_at  timestamptz,
  requiere_validacion    boolean     not null default false,  -- envíos sospechosos
  reserva_reforzada      boolean     not null default false,
  -- Cierre
  resultado_cierre       text,
  pendientes_cierre      text,                 -- tareas que quedan "pendientes de cumplimiento"
  -- Tiempos (para los objetivos de atención y los reportes)
  fecha_recepcion        timestamptz not null default now(),
  primera_respuesta_at   timestamptz,
  asignada_at            timestamptz,
  cerrada_at             timestamptz,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint crm_solicitudes_pkey primary key (id),
  constraint crm_solicitudes_codigo_key unique (codigo),
  constraint crm_solicitudes_codigo_check check (codigo ~ '^S[0-9]{2}-[0-9]{4,}$'),
  constraint crm_solicitudes_contacto_fkey
    foreign key (contacto_id) references public.crm_contactos (id),
  constraint crm_solicitudes_empresa_fkey
    foreign key (empresa_id) references public.crm_contactos (id),
  constraint crm_solicitudes_area_fkey
    foreign key (area_principal_id) references public.areas_practica (id),
  constraint crm_solicitudes_servicio_fkey
    foreign key (servicio_id) references public.servicios (id),
  constraint crm_solicitudes_empresa_distinta_check
    check (empresa_id is null or empresa_id <> contacto_id),
  constraint crm_solicitudes_descripcion_check check (btrim(descripcion) <> ''),
  constraint crm_solicitudes_canal_check check (canal_origen in (
    'web', 'cita', 'chat', 'correo', 'whatsapp', 'llamada', 'presencial', 'referido')),
  constraint crm_solicitudes_origen_check check (
    (origen_tabla is null) = (origen_id is null)),
  constraint crm_solicitudes_modalidad_check check (modalidad is null or
    modalidad in ('judicial', 'administrativa', 'extrajudicial', 'notarial')),
  constraint crm_solicitudes_urgencia_check
    check (urgencia in ('critica', 'alta', 'media', 'ordinaria')),
  constraint crm_solicitudes_estado_check check (estado in (
    'nueva', 'en_calificacion', 'pendiente_informacion', 'consulta_agendada',
    'propuesta_enviada', 'pendiente_aceptacion', 'aceptada_pendiente_asignacion',
    'asignada', 'en_curso', 'en_espera', 'cerrada', 'descartada')),
  -- R-13
  constraint crm_solicitudes_motivo_check check (
    estado not in ('en_espera', 'descartada', 'cerrada')
    or (motivo_estado is not null and btrim(motivo_estado) <> '')),
  -- R-14
  constraint crm_solicitudes_cierre_check check (
    estado <> 'cerrada'
    or (resultado_cierre is not null and btrim(resultado_cierre) <> ''
        and cerrada_at is not null)),
  constraint crm_solicitudes_servicio_area_check check (
    servicio_id is null or area_principal_id is not null),
  constraint crm_solicitudes_conflicto_check check (
    conflicto_revision in ('pendiente', 'sin_conflicto', 'con_conflicto')),
  constraint crm_solicitudes_conflicto_revisor_check check (
    conflicto_revision = 'pendiente'
    or (conflicto_revisado_por is not null and conflicto_revisado_at is not null)),
  -- R-20
  constraint crm_solicitudes_conflicto_asignacion_check check (
    estado not in ('aceptada_pendiente_asignacion', 'asignada', 'en_curso', 'en_espera')
    or conflicto_revision = 'sin_conflicto')
);

-- Una misma cita o consulta web no genera dos solicitudes (R-11, reintentos).
create unique index crm_solicitudes_origen_key
  on public.crm_solicitudes (origen_tabla, origen_id) where origen_id is not null;
create index crm_solicitudes_contacto_idx on public.crm_solicitudes (contacto_id);
create index crm_solicitudes_empresa_idx  on public.crm_solicitudes (empresa_id)
  where empresa_id is not null;
create index crm_solicitudes_estado_idx   on public.crm_solicitudes (estado, urgencia);
create index crm_solicitudes_area_idx     on public.crm_solicitudes (area_principal_id);

-- Historial de estados (solo inserción; lo llena un trigger).
create table public.crm_solicitud_estados (
  id              bigint      generated always as identity,
  solicitud_id    uuid        not null,
  estado_anterior text,
  estado_nuevo    text        not null,
  motivo          text,
  user_id         uuid,
  created_at      timestamptz not null default now(),
  constraint crm_solicitud_estados_pkey primary key (id),
  constraint crm_solicitud_estados_solicitud_fkey
    foreign key (solicitud_id) references public.crm_solicitudes (id)
);

create index crm_solicitud_estados_solicitud_idx
  on public.crm_solicitud_estados (solicitud_id, created_at);

-- Áreas adicionales para asuntos multidisciplinarios.
create table public.crm_solicitud_areas (
  solicitud_id uuid not null,
  area_id      uuid not null,
  servicio_id  uuid,
  constraint crm_solicitud_areas_pkey primary key (solicitud_id, area_id),
  constraint crm_solicitud_areas_solicitud_fkey
    foreign key (solicitud_id) references public.crm_solicitudes (id),
  constraint crm_solicitud_areas_area_fkey
    foreign key (area_id) references public.areas_practica (id),
  constraint crm_solicitud_areas_servicio_fkey
    foreign key (servicio_id) references public.servicios (id)
);

-- R-17: datos del expediente jurídico (1:1). Su estado procesal es
-- independiente del estado de atención de la solicitud.
create table public.crm_expedientes (
  solicitud_id    uuid        not null,
  numero_proceso  text,
  autoridad       text,
  contraparte     text,
  etapa_procesal  text,
  estado_procesal text,
  ultimo_acto     text,
  ultimo_acto_at  date,
  updated_at      timestamptz not null default now(),
  constraint crm_expedientes_pkey primary key (solicitud_id),
  constraint crm_expedientes_solicitud_fkey
    foreign key (solicitud_id) references public.crm_solicitudes (id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5. EQUIPO DE CADA CASO
-- ════════════════════════════════════════════════════════════════════════════
-- ESTA TABLA DEFINE QUIÉN PUEDE VER CADA CASO (solo estado 'activo'; con
-- 'pendiente_confirmacion' se ve un resumen). Ciclo de una asignación (R-22):
--   propuesto → pendiente_confirmacion (aprueba Dirección) → activo (confirma
--   el profesional) → finalizado · o → rechazado.
--   El suplente aprobado queda 'en_reserva' (sin acceso) hasta activarse.
create table public.crm_solicitud_equipo (
  id                       uuid        not null default gen_random_uuid(),
  solicitud_id             uuid        not null,
  personal_id              uuid        not null,
  rol                      text        not null,
  funciones                text,
  estado                   text        not null default 'propuesto',
  propuesto_por            uuid        not null,
  propuesto_at             timestamptz not null default now(),
  aprobado_por             uuid,
  aprobado_at              timestamptz,
  confirmado_at            timestamptz,
  finalizado_at            timestamptz,
  motivo_rechazo           text,
  supera_capacidad         boolean     not null default false,
  motivo_supera_capacidad  text,
  capacidad_autorizada_por uuid,
  constraint crm_solicitud_equipo_pkey primary key (id),
  constraint crm_solicitud_equipo_solicitud_fkey
    foreign key (solicitud_id) references public.crm_solicitudes (id),
  constraint crm_solicitud_equipo_personal_fkey
    foreign key (personal_id) references public.crm_personal (id),
  constraint crm_solicitud_equipo_rol_check
    check (rol in ('titular', 'suplente', 'coordinador', 'apoyo', 'perito')),
  constraint crm_solicitud_equipo_estado_check check (estado in (
    'propuesto', 'pendiente_confirmacion', 'activo', 'en_reserva',
    'rechazado', 'finalizado')),
  -- R-22: nada pasa de "propuesto" sin aprobación registrada.
  constraint crm_solicitud_equipo_aprobacion_check check (
    estado not in ('pendiente_confirmacion', 'activo', 'en_reserva')
    or (aprobado_por is not null and aprobado_at is not null)),
  constraint crm_solicitud_equipo_reserva_check check (
    estado <> 'en_reserva' or rol = 'suplente'),
  -- R-26: superar la capacidad exige motivo y quién lo autorizó.
  constraint crm_solicitud_equipo_capacidad_check check (
    not supera_capacidad
    or (motivo_supera_capacidad is not null and btrim(motivo_supera_capacidad) <> ''
        and capacidad_autorizada_por is not null))
);

-- R-23: un solo titular vigente por caso.
create unique index crm_solicitud_equipo_un_titular
  on public.crm_solicitud_equipo (solicitud_id)
  where rol = 'titular' and estado in ('propuesto', 'pendiente_confirmacion', 'activo');
-- R-23: la misma persona no figura dos veces vigente en el mismo equipo.
create unique index crm_solicitud_equipo_miembro_vigente
  on public.crm_solicitud_equipo (solicitud_id, personal_id)
  where estado in ('propuesto', 'pendiente_confirmacion', 'activo', 'en_reserva');
create index crm_solicitud_equipo_personal_idx
  on public.crm_solicitud_equipo (personal_id, estado);

-- R-26: carga de una persona = casos abiertos (asignados, en curso o en
-- espera) donde es titular. Un caso en espera sigue siendo suyo: si no
-- contara, pausar un caso permitiría superar el límite sin autorización.
-- Única definición, usada por el trigger de capacidad y por la vista.
create function public.crm_carga_titular(p_personal uuid, p_excluir_solicitud uuid default null)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
    from public.crm_solicitud_equipo e
    join public.crm_solicitudes s on s.id = e.solicitud_id
   where e.personal_id = p_personal
     and e.rol = 'titular'
     and e.estado in ('pendiente_confirmacion', 'activo')
     and s.estado in ('asignada', 'en_curso', 'en_espera')
     and (p_excluir_solicitud is null or s.id <> p_excluir_solicitud);
$$;

create function public.crm_solicitud_equipo_reglas()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p public.crm_personal;
  s public.crm_solicitudes;
  entra_vigente boolean;
  entra_carga   boolean;
begin
  if tg_op = 'UPDATE' and (new.solicitud_id <> old.solicitud_id
                           or new.personal_id <> old.personal_id) then
    raise exception 'CRM-R23: no se cambia la persona ni el caso de una fila de equipo; finalízala y crea otra';
  end if;

  entra_vigente := new.estado in ('propuesto', 'pendiente_confirmacion', 'activo', 'en_reserva')
    and (tg_op = 'INSERT'
         or old.estado not in ('propuesto', 'pendiente_confirmacion', 'activo', 'en_reserva')
         or new.rol <> old.rol);
  entra_carga := new.rol = 'titular'
    and new.estado in ('pendiente_confirmacion', 'activo')
    and (tg_op = 'INSERT'
         or old.estado not in ('pendiente_confirmacion', 'activo')
         or old.rol <> 'titular');

  if entra_vigente or entra_carga then
    -- Bloquea la ficha para que dos asignaciones simultáneas no burlen el límite.
    select * into p from public.crm_personal where id = new.personal_id for update;
    select * into s from public.crm_solicitudes where id = new.solicitud_id;
  end if;

  if entra_vigente then
    -- Solo se arma equipo en un caso aceptado y con conflictos revisados (R-20).
    if s.estado not in ('aceptada_pendiente_asignacion', 'asignada', 'en_curso', 'en_espera') then
      raise exception 'CRM-R22: solo se asigna equipo a un caso aceptado (estado actual: %)', s.estado;
    end if;
    if s.conflicto_revision <> 'sin_conflicto' then
      raise exception 'CRM-R20: falta la revisión de conflictos de interés sin conflicto';
    end if;
    -- R-24
    if not p.activo then
      raise exception 'CRM-R24: la persona no está activa';
    end if;
    if new.rol in ('titular', 'suplente', 'coordinador')
       and not (p.es_abogado and p.habilitacion_verificada) then
      raise exception 'CRM-R24: titular, suplente y coordinador deben ser abogados con habilitación verificada';
    end if;
    if new.rol = 'perito' and p.rol <> 'externo' then
      raise exception 'CRM-R24: el rol perito es para personal externo';
    end if;
    if p.rol = 'externo' and new.rol <> 'perito' then
      raise exception 'CRM-R24: el personal externo solo participa como perito';
    end if;
    if p.rol = 'externo' and not p.acuerdo_confidencialidad then
      raise exception 'CRM-R24: el externo no tiene acuerdo de confidencialidad firmado';
    end if;
  end if;

  -- R-26
  if entra_carga and p.capacidad_maxima is not null and not new.supera_capacidad
     and public.crm_carga_titular(new.personal_id, new.solicitud_id) >= p.capacidad_maxima then
    raise exception 'CRM-R26: la persona está en su límite de capacidad (%); requiere autorización de Dirección con motivo',
      p.capacidad_maxima;
  end if;

  -- Fechas del ciclo
  if new.estado = 'activo' and new.confirmado_at is null then
    new.confirmado_at := now();
  end if;
  if new.estado in ('rechazado', 'finalizado') and new.finalizado_at is null then
    new.finalizado_at := now();
  end if;
  if new.estado = 'rechazado'
     and (new.motivo_rechazo is null or btrim(new.motivo_rechazo) = '') then
    raise exception 'CRM-R13: rechazar una asignación exige motivo';
  end if;
  return new;
end;
$$;

create trigger crm_solicitud_equipo_reglas
  before insert or update on public.crm_solicitud_equipo
  for each row execute function public.crm_solicitud_equipo_reglas();

-- Sustituciones y reasignaciones (solo inserción).
create table public.crm_reasignaciones (
  id                  uuid        not null default gen_random_uuid(),
  solicitud_id        uuid        not null,
  desde_personal_id   uuid,
  hacia_personal_id   uuid        not null,
  motivo              text        not null,
  detalle             text,
  entrega_documentada boolean     not null default false,
  autorizado_por      uuid        not null,
  created_at          timestamptz not null default now(),
  constraint crm_reasignaciones_pkey primary key (id),
  constraint crm_reasignaciones_solicitud_fkey
    foreign key (solicitud_id) references public.crm_solicitudes (id),
  constraint crm_reasignaciones_desde_fkey
    foreign key (desde_personal_id) references public.crm_personal (id),
  constraint crm_reasignaciones_hacia_fkey
    foreign key (hacia_personal_id) references public.crm_personal (id),
  constraint crm_reasignaciones_motivo_check check (motivo in (
    'ausencia', 'vacaciones', 'exceso_carga', 'impedimento',
    'conflicto_interes', 'especialidad_complementaria', 'inactividad', 'otro')),
  constraint crm_reasignaciones_distintos_check check (
    desde_personal_id is null or desde_personal_id <> hacia_personal_id)
);

create index crm_reasignaciones_solicitud_idx on public.crm_reasignaciones (solicitud_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 6. CRONOLOGÍA: seguimientos, notas y tareas
-- ════════════════════════════════════════════════════════════════════════════
create table public.crm_actividades (
  id                    uuid        not null default gen_random_uuid(),
  contacto_id           uuid        not null,
  solicitud_id          uuid,
  tipo                  text        not null,
  canal                 text,
  descripcion           text        not null,
  resultado             text,
  es_juridica           boolean     not null default false,  -- oculta para asistencia
  -- Tareas y plazos
  responsable_id        uuid,
  vence_at              timestamptz,
  estado_tarea          text,
  completada_at         timestamptz,
  es_plazo_juridico     boolean     not null default false,
  plazo_verificado_por  uuid,
  plazo_verificado_at   timestamptz,
  autor_id              uuid,                 -- auth.users; null = acción automática
  created_at            timestamptz not null default now(),
  constraint crm_actividades_pkey primary key (id),
  constraint crm_actividades_contacto_fkey
    foreign key (contacto_id) references public.crm_contactos (id),
  constraint crm_actividades_solicitud_fkey
    foreign key (solicitud_id) references public.crm_solicitudes (id),
  constraint crm_actividades_responsable_fkey
    foreign key (responsable_id) references public.crm_personal (id),
  constraint crm_actividades_verificador_fkey
    foreign key (plazo_verificado_por) references public.crm_personal (id),
  constraint crm_actividades_descripcion_check check (btrim(descripcion) <> ''),
  constraint crm_actividades_tipo_check check (tipo in (
    'llamada', 'reunion', 'mensaje', 'actuacion', 'tarea', 'nota',
    'cambio_estado', 'asignacion', 'cita', 'sistema')),
  constraint crm_actividades_estado_tarea_check check (
    estado_tarea is null or estado_tarea in ('pendiente', 'hecha', 'cancelada')),
  -- R-40: toda tarea tiene responsable, vencimiento y estado; y solo las tareas.
  constraint crm_actividades_tarea_check check (
    (tipo = 'tarea' and responsable_id is not null and vence_at is not null
                    and estado_tarea is not null)
    or (tipo <> 'tarea' and estado_tarea is null)),
  constraint crm_actividades_hecha_check check (
    (estado_tarea = 'hecha') = (completada_at is not null)),
  -- R-41: un plazo jurídico es una tarea de un caso; la verificación va completa.
  constraint crm_actividades_plazo_check check (
    not es_plazo_juridico or (tipo = 'tarea' and solicitud_id is not null)),
  constraint crm_actividades_verificacion_check check (
    (plazo_verificado_por is null) = (plazo_verificado_at is null)
    and (plazo_verificado_por is null or es_plazo_juridico))
);

create index crm_actividades_solicitud_idx on public.crm_actividades (solicitud_id, created_at);
create index crm_actividades_contacto_idx  on public.crm_actividades (contacto_id, created_at);
create index crm_actividades_tareas_idx    on public.crm_actividades (responsable_id, vence_at)
  where estado_tarea = 'pendiente';

create function public.crm_actividades_reglas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.contacto_id is distinct from old.contacto_id
                           and new.solicitud_id is not null) then
    -- El contacto de una actividad de caso solo cambia en una fusión.
    if not exists (select 1 from public.crm_contactos c
                    where c.id = old.contacto_id and c.fusionado_en is not null)
       and not exists (select 1 from public.crm_solicitudes s
                        where s.id = new.solicitud_id and s.contacto_id = new.contacto_id) then
      raise exception 'CRM-R05: el contacto de una actividad solo cambia al fusionar fichas';
    end if;
  end if;

  if new.estado_tarea = 'hecha' and new.completada_at is null then
    new.completada_at := now();
  elsif new.estado_tarea is distinct from 'hecha' then
    new.completada_at := null;
  end if;

  -- R-41: solo verifica el titular activo del caso o Dirección.
  if new.plazo_verificado_por is not null
     and (tg_op = 'INSERT' or new.plazo_verificado_por is distinct from old.plazo_verificado_por) then
    if not exists (select 1 from public.crm_personal p
                    where p.id = new.plazo_verificado_por and p.activo and p.rol = 'direccion')
       and not exists (select 1 from public.crm_solicitud_equipo e
                        where e.solicitud_id = new.solicitud_id
                          and e.personal_id = new.plazo_verificado_por
                          and e.rol = 'titular' and e.estado = 'activo') then
      raise exception 'CRM-R41: un plazo jurídico solo lo verifica el titular del caso o Dirección';
    end if;
    if new.plazo_verificado_at is null then
      new.plazo_verificado_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger crm_actividades_reglas
  before insert or update on public.crm_actividades
  for each row execute function public.crm_actividades_reglas();

-- ════════════════════════════════════════════════════════════════════════════
-- 7. REGLAS DE LA SOLICITUD (estados, catálogo, cierre)
-- ════════════════════════════════════════════════════════════════════════════
create function public.crm_solicitudes_reglas()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  transicion_valida boolean;
  reapertura        boolean := false;
  n                 bigint;
begin
  if tg_op = 'UPDATE' and new.codigo <> old.codigo then
    raise exception 'CRM-R10: el código de una solicitud no se modifica';
  end if;
  -- ── Contacto y empresa ──────────────────────────────────────────────────
  if tg_op = 'INSERT' or new.contacto_id <> old.contacto_id then
    if exists (select 1 from public.crm_contactos c
                where c.id = new.contacto_id and c.fusionado_en is not null) then
      raise exception 'CRM-R05: el contacto fue fusionado; usa la ficha vigente';
    end if;
  end if;
  if new.empresa_id is not null
     and (tg_op = 'INSERT' or new.empresa_id is distinct from old.empresa_id) then
    if not exists (select 1 from public.crm_contactos c
                    where c.id = new.empresa_id and c.tipo = 'empresa'
                      and c.fusionado_en is null) then
      raise exception 'CRM-R07: empresa_id debe ser una empresa vigente';
    end if;
  end if;

  -- ── R-15: catálogo E5 ───────────────────────────────────────────────────
  if tg_op = 'INSERT'
     or new.area_principal_id is distinct from old.area_principal_id
     or new.servicio_id is distinct from old.servicio_id then
    if new.area_principal_id is not null
       and (tg_op = 'INSERT' or new.area_principal_id is distinct from old.area_principal_id)
       and not exists (select 1 from public.areas_practica a
                        where a.id = new.area_principal_id and a.activo) then
      raise exception 'CRM-R15: el área elegida no está activa';
    end if;
    if new.servicio_id is not null then
      if not exists (select 1 from public.servicios sv
                      where sv.id = new.servicio_id
                        and sv.area_id = new.area_principal_id) then
        raise exception 'CRM-R15: el servicio no pertenece al área principal';
      end if;
      if (tg_op = 'INSERT' or new.servicio_id is distinct from old.servicio_id)
         and not exists (select 1 from public.servicios sv
                          where sv.id = new.servicio_id and sv.activo) then
        raise exception 'CRM-R15: el servicio elegido no está activo';
      end if;
    end if;
  end if;

  -- ── Revisión de conflictos ──────────────────────────────────────────────
  if new.conflicto_revision <> 'pendiente' and new.conflicto_revisado_at is null then
    new.conflicto_revisado_at := now();
  end if;

  -- ── R-12: estados ───────────────────────────────────────────────────────
  if tg_op = 'INSERT' then
    if new.estado <> 'nueva' then
      raise exception 'CRM-R12: toda solicitud nace en estado nueva';
    end if;
    -- R-10: el código lo pone siempre la base. 4 dígitos como mínimo; al
    -- pasar de 9999 simplemente crece (S27-10000), sin truncarse.
    n := nextval('public.crm_solicitud_codigo_seq');
    new.codigo := 'S' || to_char(now() at time zone 'America/Guayaquil', 'YY') || '-' ||
                  lpad(n::text, greatest(4, length(n::text)), '0');
    new.estado_at := now();
    return new;
  end if;

  if new.estado = old.estado then
    return new;
  end if;

  transicion_valida := case old.estado
    when 'nueva'                 then new.estado in ('en_calificacion', 'descartada')
    when 'en_calificacion'       then new.estado in ('pendiente_informacion', 'consulta_agendada',
                                                     'propuesta_enviada', 'descartada')
    when 'pendiente_informacion' then new.estado in ('en_calificacion', 'descartada')
    when 'consulta_agendada'     then new.estado in ('en_calificacion', 'propuesta_enviada', 'descartada')
    when 'propuesta_enviada'     then new.estado in ('pendiente_aceptacion', 'descartada')
    when 'pendiente_aceptacion'  then new.estado in ('aceptada_pendiente_asignacion', 'descartada')
    when 'aceptada_pendiente_asignacion' then new.estado in ('asignada', 'descartada')
    when 'asignada'              then new.estado in ('en_curso', 'aceptada_pendiente_asignacion')
    when 'en_curso'              then new.estado in ('en_espera', 'cerrada')
    when 'en_espera'             then new.estado in ('en_curso', 'cerrada')
    when 'cerrada'               then new.estado in ('en_curso')
    when 'descartada'            then new.estado in ('en_calificacion')
    else false
  end;
  if not transicion_valida then
    raise exception 'CRM-R12: transición no permitida: % → %', old.estado, new.estado;
  end if;

  reapertura := old.estado in ('cerrada', 'descartada');

  -- R-13: el motivo debe escribirse en este cambio, no heredarse del anterior.
  if new.motivo_estado is not distinct from old.motivo_estado then
    new.motivo_estado := null;
  end if;
  if (new.estado in ('en_espera', 'descartada', 'cerrada')
      or reapertura
      or (old.estado = 'asignada' and new.estado = 'aceptada_pendiente_asignacion'))
     and (new.motivo_estado is null or btrim(new.motivo_estado) = '') then
    raise exception 'CRM-R13: el cambio % → % exige motivo', old.estado, new.estado;
  end if;

  -- R-22/R-23: no hay caso asignado sin titular, ni en curso sin titular confirmado.
  if new.estado = 'asignada' then
    if not exists (select 1 from public.crm_solicitud_equipo e
                    where e.solicitud_id = new.id and e.rol = 'titular'
                      and e.estado in ('pendiente_confirmacion', 'activo')) then
      raise exception 'CRM-R22: no se puede pasar a asignada sin un titular aprobado por Dirección';
    end if;
    new.asignada_at := now();
  end if;
  if new.estado = 'en_curso' then
    if not exists (select 1 from public.crm_solicitud_equipo e
                    where e.solicitud_id = new.id and e.rol = 'titular'
                      and e.estado = 'activo') then
      raise exception 'CRM-R23: no se puede pasar a en curso sin un titular que haya confirmado';
    end if;
  end if;
  if old.estado = 'asignada' and new.estado = 'aceptada_pendiente_asignacion' then
    new.asignada_at := null;
  end if;

  -- R-14: cierre
  if new.estado = 'cerrada' then
    if exists (select 1 from public.crm_actividades a
                where a.solicitud_id = new.id and a.estado_tarea = 'pendiente')
       and (new.pendientes_cierre is null or btrim(new.pendientes_cierre) = '') then
      raise exception 'CRM-R14: hay tareas abiertas; complétalas o regístralas como pendientes de cumplimiento';
    end if;
    new.cerrada_at := now();
  end if;
  if old.estado = 'cerrada' then
    new.cerrada_at        := null;
    new.resultado_cierre  := null;
    new.pendientes_cierre := null;
  end if;

  new.estado_at := now();
  return new;
end;
$$;

create trigger crm_solicitudes_reglas
  before insert or update on public.crm_solicitudes
  for each row execute function public.crm_solicitudes_reglas();

create function public.crm_solicitudes_historial()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.crm_solicitud_estados (solicitud_id, estado_anterior, estado_nuevo, motivo, user_id)
    values (new.id, null, new.estado, new.motivo_estado, coalesce(new.estado_por, new.created_by));
  elsif new.estado <> old.estado then
    insert into public.crm_solicitud_estados (solicitud_id, estado_anterior, estado_nuevo, motivo, user_id)
    values (new.id, old.estado, new.estado, new.motivo_estado, new.estado_por);
  end if;
  return null;
end;
$$;

create trigger crm_solicitudes_historial
  after insert or update on public.crm_solicitudes
  for each row execute function public.crm_solicitudes_historial();

-- R-15 también para las áreas adicionales.
create function public.crm_solicitud_areas_reglas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.areas_practica a where a.id = new.area_id and a.activo) then
    raise exception 'CRM-R15: el área elegida no está activa';
  end if;
  if new.servicio_id is not null
     and not exists (select 1 from public.servicios sv
                      where sv.id = new.servicio_id and sv.area_id = new.area_id and sv.activo) then
    raise exception 'CRM-R15: el servicio no pertenece al área o no está activo';
  end if;
  return new;
end;
$$;

create trigger crm_solicitud_areas_reglas
  before insert or update on public.crm_solicitud_areas
  for each row execute function public.crm_solicitud_areas_reglas();

-- ════════════════════════════════════════════════════════════════════════════
-- 8. NOTIFICACIONES (bandeja de salida: registra si se envió o falló — R-44)
-- ════════════════════════════════════════════════════════════════════════════
create table public.crm_notificaciones (
  id               uuid        not null default gen_random_uuid(),
  destinatario_id  uuid,                     -- personal del estudio (auth.users)
  contacto_id      uuid,                     -- o un contacto (aviso al cliente)
  canal            text        not null,
  tipo             text        not null,
  solicitud_id     uuid,
  cita_id          uuid,
  titulo           text        not null,     -- información mínima, sin datos sensibles
  url              text,
  programada_para  timestamptz not null default now(),
  estado           text        not null default 'pendiente',
  intentos         integer     not null default 0,
  ultimo_error     text,
  enviada_at       timestamptz,
  leida_at         timestamptz,
  created_at       timestamptz not null default now(),
  constraint crm_notificaciones_pkey primary key (id),
  constraint crm_notificaciones_destinatario_fkey
    foreign key (destinatario_id) references auth.users (id) on delete cascade,
  constraint crm_notificaciones_contacto_fkey
    foreign key (contacto_id) references public.crm_contactos (id),
  constraint crm_notificaciones_solicitud_fkey
    foreign key (solicitud_id) references public.crm_solicitudes (id),
  constraint crm_notificaciones_cita_fkey
    foreign key (cita_id) references public.citas (id) on delete set null,
  constraint crm_notificaciones_un_destino_check check (
    (destinatario_id is not null) <> (contacto_id is not null)),
  constraint crm_notificaciones_canal_check
    check (canal in ('panel', 'correo', 'push', 'whatsapp')),
  constraint crm_notificaciones_panel_check check (
    canal <> 'panel' or destinatario_id is not null),
  constraint crm_notificaciones_estado_check
    check (estado in ('pendiente', 'enviada', 'fallida', 'cancelada')),
  constraint crm_notificaciones_resultado_check check (
    (estado <> 'enviada' or enviada_at is not null)
    and (estado <> 'fallida' or ultimo_error is not null)),
  constraint crm_notificaciones_intentos_check check (intentos >= 0)
);

create index crm_notificaciones_pendientes_idx
  on public.crm_notificaciones (programada_para) where estado = 'pendiente';
create index crm_notificaciones_destinatario_idx
  on public.crm_notificaciones (destinatario_id, created_at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- 9. BITÁCORA DE AUDITORÍA (solo inserción — R-50, R-51)
-- ════════════════════════════════════════════════════════════════════════════
create table public.crm_bitacora (
  id               bigint      generated always as identity,
  user_id          uuid,                     -- null = acción automática
  accion           text        not null,
  entidad          text        not null,
  entidad_id       text,
  valores_antes    jsonb,
  valores_despues  jsonb,
  motivo           text,
  detalle          jsonb,                    -- p. ej. filtros de una exportación
  created_at       timestamptz not null default now(),
  constraint crm_bitacora_pkey primary key (id),
  constraint crm_bitacora_accion_check check (accion in (
    'crear', 'actualizar', 'cambiar_estado', 'revisar_conflicto',
    'proponer_asignacion', 'aprobar_asignacion', 'confirmar_asignacion',
    'rechazar_asignacion', 'reasignar', 'autorizar_capacidad',
    'fusionar', 'descartar_duplicado', 'cerrar', 'reabrir',
    'agendar_cita', 'reagendar_cita', 'cancelar_cita', 'verificar_plazo',
    'exportar', 'ver_reservado', 'acceso_excepcional',
    'crear_usuario', 'cambiar_rol', 'desactivar_usuario', 'reactivar_usuario'))
);

create index crm_bitacora_entidad_idx on public.crm_bitacora (entidad, entidad_id, created_at);
create index crm_bitacora_usuario_idx on public.crm_bitacora (user_id, created_at);

create function public.crm_solo_insercion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'CRM-R50: % es de solo inserción', tg_table_name;
end;
$$;

create trigger crm_bitacora_inmutable
  before update or delete on public.crm_bitacora
  for each row execute function public.crm_solo_insercion();
create trigger crm_bitacora_sin_truncate
  before truncate on public.crm_bitacora
  for each statement execute function public.crm_solo_insercion();
create trigger crm_solicitud_estados_inmutable
  before update or delete on public.crm_solicitud_estados
  for each row execute function public.crm_solo_insercion();
create trigger crm_reasignaciones_inmutable
  before update or delete on public.crm_reasignaciones
  for each row execute function public.crm_solo_insercion();

-- ════════════════════════════════════════════════════════════════════════════
-- 10. OPERACIONES ATÓMICAS
-- ════════════════════════════════════════════════════════════════════════════
-- R-05: fusiona p_fusionada dentro de p_conserva. Todo o nada.
create function public.crm_fusionar_contactos(
  p_conserva uuid, p_fusionada uuid, p_usuario uuid, p_motivo text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  a public.crm_contactos;
  b public.crm_contactos;
begin
  if p_conserva = p_fusionada then
    raise exception 'CRM-R05: no se puede fusionar una ficha consigo misma';
  end if;
  -- Bloqueo en orden fijo para evitar interbloqueos entre dos fusiones.
  perform 1 from public.crm_contactos
    where id in (p_conserva, p_fusionada) order by id for update;
  select * into a from public.crm_contactos where id = p_conserva;
  select * into b from public.crm_contactos where id = p_fusionada;
  if a.id is null or b.id is null then
    raise exception 'CRM-R05: contacto inexistente';
  end if;
  if a.fusionado_en is not null or b.fusionado_en is not null then
    raise exception 'CRM-R05: una de las fichas ya fue fusionada';
  end if;
  if a.tipo <> b.tipo then
    raise exception 'CRM-R05: no se fusiona una persona con una empresa';
  end if;

  -- Primero se marca la ficha absorbida: así las reglas reconocen la fusión.
  update public.crm_contactos
     set fusionado_en = p_conserva, archivado_at = now()
   where id = p_fusionada;

  update public.crm_solicitudes set contacto_id = p_conserva where contacto_id = p_fusionada;
  update public.crm_solicitudes set empresa_id  = p_conserva where empresa_id  = p_fusionada;
  update public.crm_actividades set contacto_id = p_conserva where contacto_id = p_fusionada;
  update public.crm_notificaciones set contacto_id = p_conserva where contacto_id = p_fusionada;

  delete from public.crm_contacto_vinculos v
   where v.persona_id = p_fusionada
     and exists (select 1 from public.crm_contacto_vinculos x
                  where x.persona_id = p_conserva and x.empresa_id = v.empresa_id);
  update public.crm_contacto_vinculos set persona_id = p_conserva where persona_id = p_fusionada;
  delete from public.crm_contacto_vinculos v
   where v.empresa_id = p_fusionada
     and exists (select 1 from public.crm_contacto_vinculos x
                  where x.empresa_id = p_conserva and x.persona_id = v.persona_id);
  update public.crm_contacto_vinculos set empresa_id = p_conserva where empresa_id = p_fusionada;

  update public.crm_posibles_duplicados
     set estado = 'fusionado', resuelto_por = p_usuario, resuelto_at = now()
   where estado = 'pendiente' and p_fusionada in (contacto_a, contacto_b);

  insert into public.crm_bitacora (user_id, accion, entidad, entidad_id, valores_antes, motivo, detalle)
  values (p_usuario, 'fusionar', 'crm_contactos', p_conserva::text, to_jsonb(b), p_motivo,
          jsonb_build_object('fusionada', p_fusionada));
end;
$$;

-- R-22: los tres pasos de la asignación. Cada uno cambia la fila del equipo
-- y, si es el titular, el estado del caso, en una sola operación.
create function public.crm_aprobar_asignacion(
  p_equipo uuid, p_usuario uuid,
  p_supera_capacidad boolean default false, p_motivo_capacidad text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  e public.crm_solicitud_equipo;
  s public.crm_solicitudes;
begin
  select * into e from public.crm_solicitud_equipo where id = p_equipo for update;
  if e.id is null or e.estado <> 'propuesto' then
    raise exception 'CRM-R22: solo se aprueba una asignación en estado propuesto';
  end if;
  if p_usuario is null then
    raise exception 'CRM-R22: la aprobación debe registrar quién aprueba';
  end if;
  select * into s from public.crm_solicitudes where id = e.solicitud_id for update;

  update public.crm_solicitud_equipo
     set estado = case when e.rol = 'suplente' then 'en_reserva' else 'pendiente_confirmacion' end,
         aprobado_por = p_usuario, aprobado_at = now(),
         supera_capacidad = p_supera_capacidad,
         motivo_supera_capacidad = p_motivo_capacidad,
         capacidad_autorizada_por = case when p_supera_capacidad then p_usuario end
   where id = p_equipo;

  if e.rol = 'titular' and s.estado = 'aceptada_pendiente_asignacion' then
    update public.crm_solicitudes
       set estado = 'asignada', estado_por = p_usuario where id = s.id;
  end if;

  insert into public.crm_bitacora (user_id, accion, entidad, entidad_id, motivo, detalle)
  values (p_usuario,
          case when p_supera_capacidad then 'autorizar_capacidad' else 'aprobar_asignacion' end,
          'crm_solicitudes', s.id::text, p_motivo_capacidad,
          jsonb_build_object('equipo', p_equipo, 'personal', e.personal_id, 'rol', e.rol));
end;
$$;

-- Solo responde la propia persona asignada: p_usuario debe ser su cuenta.
create function public.crm_responder_asignacion(
  p_equipo uuid, p_usuario uuid, p_acepta boolean, p_motivo text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  e public.crm_solicitud_equipo;
  s public.crm_solicitudes;
begin
  select * into e from public.crm_solicitud_equipo where id = p_equipo for update;
  if e.id is null or e.estado <> 'pendiente_confirmacion' then
    raise exception 'CRM-R22: la asignación no está pendiente de confirmación';
  end if;
  if not exists (select 1 from public.crm_personal p
                  where p.id = e.personal_id and p.user_id = p_usuario and p.activo) then
    raise exception 'CRM-R22: solo la persona asignada puede confirmar o rechazar';
  end if;
  select * into s from public.crm_solicitudes where id = e.solicitud_id for update;

  if p_acepta then
    update public.crm_solicitud_equipo set estado = 'activo' where id = p_equipo;
    if e.rol = 'titular' and s.estado = 'asignada' then
      update public.crm_solicitudes
         set estado = 'en_curso', estado_por = p_usuario where id = s.id;
    end if;
  else
    update public.crm_solicitud_equipo
       set estado = 'rechazado', motivo_rechazo = p_motivo where id = p_equipo;
    if e.rol = 'titular' and s.estado = 'asignada' then
      update public.crm_solicitudes
         set estado = 'aceptada_pendiente_asignacion', estado_por = p_usuario,
             motivo_estado = 'Asignación rechazada: ' || p_motivo
       where id = s.id;
    end if;
  end if;

  insert into public.crm_bitacora (user_id, accion, entidad, entidad_id, motivo, detalle)
  values (p_usuario,
          case when p_acepta then 'confirmar_asignacion' else 'rechazar_asignacion' end,
          'crm_solicitudes', s.id::text, p_motivo,
          jsonb_build_object('equipo', p_equipo, 'personal', e.personal_id, 'rol', e.rol));
end;
$$;

-- R-27: cambia el titular de un caso (incluye activar al suplente). Todo o nada.
create function public.crm_reasignar_titular(
  p_solicitud uuid, p_nuevo_titular uuid, p_motivo text, p_autorizado_por uuid,
  p_detalle text default null, p_entrega_documentada boolean default false,
  p_supera_capacidad boolean default false, p_motivo_capacidad text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  s          public.crm_solicitudes;
  v_anterior uuid;
  v_fila     uuid;
begin
  select * into s from public.crm_solicitudes where id = p_solicitud for update;
  if s.id is null then
    raise exception 'CRM-R27: caso inexistente';
  end if;
  if s.estado not in ('asignada', 'en_curso', 'en_espera') then
    raise exception 'CRM-R27: solo se reasigna un caso asignado, en curso o en espera';
  end if;

  select e.personal_id into v_anterior
    from public.crm_solicitud_equipo e
   where e.solicitud_id = p_solicitud and e.rol = 'titular'
     and e.estado in ('propuesto', 'pendiente_confirmacion', 'activo');
  if v_anterior = p_nuevo_titular then
    raise exception 'CRM-R27: esa persona ya es titular del caso';
  end if;

  update public.crm_solicitud_equipo
     set estado = 'finalizado'
   where solicitud_id = p_solicitud
     and estado in ('propuesto', 'pendiente_confirmacion', 'activo', 'en_reserva')
     and (rol = 'titular' or personal_id = p_nuevo_titular);

  insert into public.crm_solicitud_equipo (
    solicitud_id, personal_id, rol, estado, propuesto_por, aprobado_por, aprobado_at,
    supera_capacidad, motivo_supera_capacidad, capacidad_autorizada_por)
  values (
    p_solicitud, p_nuevo_titular, 'titular', 'activo', p_autorizado_por, p_autorizado_por, now(),
    p_supera_capacidad, p_motivo_capacidad,
    case when p_supera_capacidad then p_autorizado_por end)
  returning id into v_fila;

  insert into public.crm_reasignaciones (
    solicitud_id, desde_personal_id, hacia_personal_id, motivo, detalle,
    entrega_documentada, autorizado_por)
  values (p_solicitud, v_anterior, p_nuevo_titular, p_motivo, p_detalle,
          p_entrega_documentada, p_autorizado_por);

  insert into public.crm_bitacora (user_id, accion, entidad, entidad_id, motivo, detalle)
  values (p_autorizado_por, 'reasignar', 'crm_solicitudes', p_solicitud::text, p_motivo,
          jsonb_build_object('desde', v_anterior, 'hacia', p_nuevo_titular,
                             'supera_capacidad', p_supera_capacidad));
  return v_fila;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. VISTA DE CARGA POR PERSONA
-- ════════════════════════════════════════════════════════════════════════════
create view public.crm_v_carga_personal
with (security_invoker = true) as
select p.id                                   as personal_id,
       p.nombres || ' ' || p.apellidos        as nombre,
       p.rol,
       p.capacidad_maxima,
       public.crm_carga_titular(p.id)         as carga_titular,
       (select count(*)::integer from public.crm_solicitud_equipo e
          join public.crm_solicitudes s on s.id = e.solicitud_id
         where e.personal_id = p.id and e.estado = 'activo' and e.rol <> 'titular'
           and s.estado in ('asignada', 'en_curso', 'en_espera')) as casos_apoyo,
       (select count(*)::integer from public.crm_actividades a
         where a.responsable_id = p.id and a.estado_tarea = 'pendiente'
           and a.vence_at < now())                             as tareas_vencidas,
       (select count(*)::integer from public.crm_actividades a
         where a.responsable_id = p.id and a.estado_tarea = 'pendiente'
           and a.vence_at >= now()
           and a.vence_at < now() + interval '7 days')         as tareas_7_dias
  from public.crm_personal p
 where p.activo;

-- ════════════════════════════════════════════════════════════════════════════
-- 12. TRIGGERS DE updated_at
-- ════════════════════════════════════════════════════════════════════════════
create trigger crm_personal_updated_at before update on public.crm_personal
  for each row execute function public.set_updated_at();
create trigger crm_contactos_updated_at before update on public.crm_contactos
  for each row execute function public.set_updated_at();
create trigger crm_solicitudes_updated_at before update on public.crm_solicitudes
  for each row execute function public.set_updated_at();
create trigger crm_expedientes_updated_at before update on public.crm_expedientes
  for each row execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 13. RLS Y PERMISOS (misma convención que M2 y el catálogo E5)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.crm_personal            enable row level security;
alter table public.crm_personal_areas      enable row level security;
alter table public.crm_horarios            enable row level security;
alter table public.crm_bloqueos            enable row level security;
alter table public.crm_turnos              enable row level security;
alter table public.crm_contactos           enable row level security;
alter table public.crm_contacto_vinculos   enable row level security;
alter table public.crm_posibles_duplicados enable row level security;
alter table public.crm_solicitudes         enable row level security;
alter table public.crm_solicitud_estados   enable row level security;
alter table public.crm_solicitud_areas     enable row level security;
alter table public.crm_expedientes         enable row level security;
alter table public.crm_solicitud_equipo    enable row level security;
alter table public.crm_reasignaciones      enable row level security;
alter table public.crm_actividades         enable row level security;
alter table public.crm_notificaciones      enable row level security;
alter table public.crm_bitacora            enable row level security;

revoke all on table
  public.crm_personal, public.crm_personal_areas, public.crm_horarios,
  public.crm_bloqueos, public.crm_turnos, public.crm_contactos,
  public.crm_contacto_vinculos, public.crm_posibles_duplicados,
  public.crm_solicitudes, public.crm_solicitud_estados, public.crm_solicitud_areas,
  public.crm_expedientes, public.crm_solicitud_equipo, public.crm_reasignaciones,
  public.crm_actividades, public.crm_notificaciones, public.crm_bitacora,
  public.crm_v_carga_personal
from public, anon, authenticated, service_role;
revoke all on sequence public.crm_solicitud_codigo_seq
  from public, anon, authenticated, service_role;

-- R-52: fichas, casos y actividades se archivan o finalizan; sin DELETE.
grant select, insert, update on table public.crm_personal            to service_role;
grant select, insert, update on table public.crm_contactos           to service_role;
grant select, insert, update on table public.crm_posibles_duplicados to service_role;
grant select, insert, update on table public.crm_solicitudes         to service_role;
grant select, insert, update on table public.crm_expedientes         to service_role;
grant select, insert, update on table public.crm_solicitud_equipo    to service_role;
grant select, insert, update on table public.crm_actividades         to service_role;
grant select, insert, update on table public.crm_notificaciones      to service_role;
-- Configuración y relaciones que se editan quitando filas.
grant select, insert, update, delete on table public.crm_personal_areas    to service_role;
grant select, insert, update, delete on table public.crm_horarios          to service_role;
grant select, insert, update, delete on table public.crm_bloqueos          to service_role;
grant select, insert, update, delete on table public.crm_turnos            to service_role;
grant select, insert, update, delete on table public.crm_contacto_vinculos to service_role;
grant select, insert, update, delete on table public.crm_solicitud_areas   to service_role;
-- Historiales: solo lectura e inserción.
grant select, insert on table public.crm_solicitud_estados to service_role;
grant select, insert on table public.crm_reasignaciones    to service_role;
grant select, insert on table public.crm_bitacora          to service_role;
grant select on table public.crm_v_carga_personal          to service_role;

grant usage on sequence public.crm_solicitud_codigo_seq to service_role;

-- Funciones: nadie las ejecuta salvo service_role (las de trigger, ni eso).
revoke execute on function
  public.crm_personal_reglas(), public.crm_personal_areas_reglas(),
  public.crm_contacto_vinculos_reglas(), public.crm_solicitud_equipo_reglas(),
  public.crm_actividades_reglas(), public.crm_solicitudes_reglas(),
  public.crm_solicitudes_historial(), public.crm_solicitud_areas_reglas(),
  public.crm_solo_insercion(),
  public.crm_carga_titular(uuid, uuid),
  public.crm_fusionar_contactos(uuid, uuid, uuid, text),
  public.crm_aprobar_asignacion(uuid, uuid, boolean, text),
  public.crm_responder_asignacion(uuid, uuid, boolean, text),
  public.crm_reasignar_titular(uuid, uuid, text, uuid, text, boolean, boolean, text)
from public, anon, authenticated, service_role;

grant execute on function public.crm_carga_titular(uuid, uuid) to service_role;
grant execute on function public.crm_fusionar_contactos(uuid, uuid, uuid, text) to service_role;
grant execute on function public.crm_aprobar_asignacion(uuid, uuid, boolean, text) to service_role;
grant execute on function public.crm_responder_asignacion(uuid, uuid, boolean, text) to service_role;
grant execute on function
  public.crm_reasignar_titular(uuid, uuid, text, uuid, text, boolean, boolean, text)
  to service_role;

commit;
