-- ════════════════════════════════════════════════════════════════════════════
-- M5 — Citas con abogado, duración y sin cruces  (BORRADOR PARA REVISIÓN)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠ ESTE ARCHIVO MODIFICA public.citas, UNA TABLA QUE NO ES DEL MÓDULO E6.
--   Requiere autorización expresa del responsable y coordinación con E2
--   (agenda) y E7 (recordatorios). Por eso va separado de M4.
--
-- QUÉ HACE
--   · Agrega a citas: abogado_id, solicitud_id, duracion_min, reagendada_de y
--     los datos de cancelación. Todas las columnas nuevas son opcionales o
--     tienen valor por defecto: el código actual sigue funcionando.
--   · Amplía los estados: pendiente, confirmada, cancelada + atendida, no_asistio.
--   · R-30: dos citas activas del mismo abogado no pueden cruzarse.
--   · R-31: mientras una cita no tiene abogado, solo una activa por fecha y hora
--     (cierra la condición de carrera señalada en docs/AUDITORIA_SEGURIDAD.md).
--   · R-38: una cita cancelada no se reactiva; se agenda una nueva.
--   · R-37: crm_cancelar_cita() cancela con motivo, todo o nada.
--   · R-18: no se cierra ni descarta un caso con citas futuras activas.
--   "Activa" = estado pendiente o confirmada. Cancelar libera la hora.
--
-- IMPACTO SOBRE EL CÓDIGO EXISTENTE (revisar antes de aplicar)
--   · Si el panel actual permite devolver una cita cancelada a pendiente o
--     confirmada, la base lo rechazará (CRM-R38). Hay que ajustar esa pantalla.
--   · Un segundo INSERT en la misma fecha y hora sin abogado fallará con
--     código 23505; /api/appointments debe responder "horario ocupado".
--   · La columna motivo_cancelacion no es obligatoria en la tabla, para no
--     romper la ruta de cancelación actual. El CRM cancela SIEMPRE con la
--     función crm_cancelar_cita(), que sí exige motivo y origen (R-37).
--
-- DEPENDENCIAS: M1 (citas), M4 (crm_personal, crm_solicitudes, btree_gist).
-- NO EJECUTAR EN EL SUPABASE DEV COMPARTIDO SIN AUTORIZACIÓN DEL RESPONSABLE.
-- Ejecuta el archivo COMPLETO. Si la sesión queda abortada: ROLLBACK;
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── Comprobación previa ────────────────────────────────────────────────────
do $$
declare
  repetidas text;
begin
  if pg_catalog.to_regclass('public.crm_personal') is null
     or pg_catalog.to_regclass('public.crm_solicitudes') is null then
    raise exception 'M5 ABORTADA: aplica M4 primero.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'citas'
                and column_name = 'abogado_id') then
    raise exception 'M5 ABORTADA: citas.abogado_id ya existe.';
  end if;

  -- Si ya hay dos citas activas en el mismo horario, no se puede crear la
  -- regla R-31. Se listan para que una persona decida cuál conservar.
  select string_agg(fecha::text || ' ' || hora::text, ', ' order by fecha, hora)
    into repetidas
    from (select fecha, hora from public.citas
           where estado in ('pendiente', 'confirmada')
           group by fecha, hora having count(*) > 1) d;
  if repetidas is not null then
    raise exception 'M5 ABORTADA: hay citas activas repetidas en: %. Resuélvelas primero.', repetidas;
  end if;
end
$$;

-- ─── Columnas nuevas ────────────────────────────────────────────────────────
alter table public.citas
  add column abogado_id         uuid,
  add column solicitud_id       uuid,
  add column duracion_min       integer not null default 60,
  add column reagendada_de      uuid,
  add column cancelada_at       timestamptz,
  add column cancelada_por      uuid,
  add column cancelada_origen   text,
  add column motivo_cancelacion text;

alter table public.citas
  add constraint citas_abogado_fkey
    foreign key (abogado_id) references public.crm_personal (id),
  add constraint citas_solicitud_fkey
    foreign key (solicitud_id) references public.crm_solicitudes (id),
  add constraint citas_reagendada_de_fkey
    foreign key (reagendada_de) references public.citas (id) on delete set null,
  add constraint citas_reagendada_de_check
    check (reagendada_de is null or reagendada_de <> id),
  add constraint citas_duracion_check
    check (duracion_min between 15 and 480),
  -- La cita termina el mismo día en que empieza.
  add constraint citas_fin_mismo_dia_check
    check (hora + make_interval(mins => duracion_min) > hora),
  add constraint citas_cancelada_origen_check
    check (cancelada_origen is null or cancelada_origen in ('cliente', 'estudio', 'abogado')),
  -- Los datos de cancelación solo existen en una cita cancelada.
  add constraint citas_cancelacion_check check (
    estado = 'cancelada'
    or (cancelada_at is null and cancelada_por is null
        and cancelada_origen is null and motivo_cancelacion is null));

alter table public.citas drop constraint citas_estado_check;
alter table public.citas add constraint citas_estado_check
  check (estado in ('pendiente', 'confirmada', 'cancelada', 'atendida', 'no_asistio'));

-- ─── R-30: sin cruces por abogado ───────────────────────────────────────────
-- fecha y hora son hora local de Guayaquil, por eso el rango es sin zona.
alter table public.citas
  add constraint citas_sin_cruce_abogado exclude using gist (
    abogado_id with =,
    tsrange(fecha + hora, fecha + hora + make_interval(mins => duracion_min)) with &&)
  where (abogado_id is not null and estado in ('pendiente', 'confirmada'));

-- ─── R-31: sin abogado, una sola cita activa por fecha y hora ───────────────
create unique index citas_un_turno_sin_abogado
  on public.citas (fecha, hora)
  where abogado_id is null and estado in ('pendiente', 'confirmada');

create index citas_abogado_fecha_idx on public.citas (abogado_id, fecha)
  where abogado_id is not null;
create index citas_solicitud_idx on public.citas (solicitud_id)
  where solicitud_id is not null;

-- ─── Reglas de fila ─────────────────────────────────────────────────────────
create function public.crm_citas_reglas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- R-38
    if old.estado = 'cancelada' and new.estado <> 'cancelada' then
      raise exception 'CRM-R38: una cita cancelada no se reactiva; agenda una nueva';
    end if;
    if old.estado in ('atendida', 'no_asistio')
       and new.estado in ('pendiente', 'confirmada') then
      raise exception 'CRM-R38: una cita ya concluida no vuelve a estar activa';
    end if;
  end if;

  if new.estado = 'cancelada' and new.cancelada_at is null then
    new.cancelada_at := now();
  end if;

  -- El abogado de una cita activa debe ser un abogado activo del estudio.
  if new.abogado_id is not null and new.estado in ('pendiente', 'confirmada')
     and (tg_op = 'INSERT' or new.abogado_id is distinct from old.abogado_id
          or old.estado not in ('pendiente', 'confirmada')) then
    if not exists (select 1 from public.crm_personal p
                    where p.id = new.abogado_id and p.activo and p.es_abogado) then
      raise exception 'CRM-R32: la cita debe asignarse a un abogado activo';
    end if;
  end if;
  return new;
end;
$$;

create trigger crm_citas_reglas
  before insert or update on public.citas
  for each row execute function public.crm_citas_reglas();

revoke execute on function public.crm_citas_reglas()
  from public, anon, authenticated, service_role;

-- ─── R-37: cancelar una cita, todo o nada ───────────────────────────────────
-- Cancela, libera la hora, devuelve la solicitud a "en calificación" si
-- estaba en "consulta agendada" y deja la tarea de reagendar.
create function public.crm_cancelar_cita(
  p_cita uuid, p_origen text, p_motivo text,
  p_usuario uuid default null, p_responsable_tarea uuid default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  c public.citas;
  s public.crm_solicitudes;
begin
  select * into c from public.citas where id = p_cita for update;
  if c.id is null or c.estado not in ('pendiente', 'confirmada') then
    raise exception 'CRM-R37: solo se cancela una cita activa';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) < 5 then
    raise exception 'CRM-R37: cancelar una cita exige motivo';
  end if;

  update public.citas
     set estado = 'cancelada', cancelada_origen = p_origen,
         motivo_cancelacion = btrim(p_motivo), cancelada_por = p_usuario
   where id = p_cita;

  if c.solicitud_id is not null then
    select * into s from public.crm_solicitudes where id = c.solicitud_id for update;
    if s.estado = 'consulta_agendada'
       and not exists (select 1 from public.citas o
                        where o.solicitud_id = s.id and o.id <> p_cita
                          and o.estado in ('pendiente', 'confirmada')) then
      update public.crm_solicitudes
         set estado = 'en_calificacion', estado_por = p_usuario,
             motivo_estado = 'Cita cancelada: ' || btrim(p_motivo)
       where id = s.id;
    end if;
    if p_responsable_tarea is not null then
      insert into public.crm_actividades (
        contacto_id, solicitud_id, tipo, descripcion, responsable_id,
        vence_at, estado_tarea, autor_id)
      values (s.contacto_id, s.id, 'tarea',
              'Contactar al cliente y reagendar la cita cancelada del '
                || to_char(c.fecha, 'DD/MM/YYYY') || ' ' || to_char(c.hora, 'HH24:MI'),
              p_responsable_tarea, now() + interval '1 day', 'pendiente', p_usuario);
    end if;
  end if;

  insert into public.crm_bitacora (user_id, accion, entidad, entidad_id, motivo, detalle)
  values (p_usuario, 'cancelar_cita', 'citas', p_cita::text, btrim(p_motivo),
          jsonb_build_object('origen', p_origen, 'fecha', c.fecha, 'hora', c.hora,
                             'abogado', c.abogado_id, 'solicitud', c.solicitud_id));
end;
$$;

revoke execute on function public.crm_cancelar_cita(uuid, text, text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.crm_cancelar_cita(uuid, text, text, uuid, uuid) to service_role;

-- ─── R-18: no se cierra ni descarta un caso con citas futuras activas ───────
create function public.crm_solicitudes_citas_reglas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.estado in ('cerrada', 'descartada') and new.estado <> old.estado
     and exists (select 1 from public.citas c
                  where c.solicitud_id = new.id
                    and c.estado in ('pendiente', 'confirmada')
                    and c.fecha + c.hora > (now() at time zone 'America/Guayaquil')) then
    raise exception 'CRM-R18: el caso tiene citas futuras activas; cancélalas antes de cerrar o descartar';
  end if;
  return new;
end;
$$;

create trigger crm_solicitudes_citas_reglas
  before update on public.crm_solicitudes
  for each row execute function public.crm_solicitudes_citas_reglas();

revoke execute on function public.crm_solicitudes_citas_reglas()
  from public, anon, authenticated, service_role;

-- Los permisos de public.citas no se tocan: siguen siendo los de M2.

commit;
