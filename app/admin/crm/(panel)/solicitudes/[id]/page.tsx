import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import SolicitudAcciones from '@/components/crm/SolicitudAcciones'
import { IndicadorEstado, IndicadorUrgencia } from '@/components/crm/IndicadoresSolicitud'
import { formatoFechaHora } from '@/components/crm/formato'
import {
  esTitularActivo, personalDePagina, puedeCrearActividad, puedeEditarExpediente, puedeGestionarCitasDe, puedeVerExpediente, recibeJuridicas,
} from '@/lib/crm/permisos'
import { uuidSchema } from '@/lib/crm/schemas'
import { detalleSolicitud, type DetalleSolicitud } from '@/lib/crm/detalles'
import { ETIQUETA_ESTADO, FASE_ESTADO, type Estado } from '@/lib/crm/estados'
import EquipoPanel, { type MiembroVista } from '@/components/crm/EquipoPanel'
import {
  equipoDeSolicitud, ETIQUETA_ESTADO_EQUIPO, ETIQUETA_MOTIVO_REASIGNACION, ETIQUETA_ROL_EQUIPO,
} from '@/lib/crm/asignacion'
import CronologiaPanel from '@/components/crm/CronologiaPanel'
import CitasLista from '@/components/crm/CitasLista'
import ExpedienteForm from '@/components/crm/ExpedienteForm'
import Franja from '@/components/crm/Franja'
import { BOTON_BARRA } from '@/components/crm/estilos'
import { citasParaPantalla, listarCitas } from '@/lib/crm/citas'
import { CAMPOS_EXPEDIENTE, obtenerExpediente } from '@/lib/crm/expediente'

const AVISO_E4: Record<string, string> = {
  cita_agendada: 'Cita agendada.',
  cita_reagendada: 'Cita actualizada.',
  tarea_creada: 'Tarea creada.',
}

export const dynamic = 'force-dynamic'

const CANAL: Record<string, string> = {
  web: 'Formulario web', cita: 'Reserva de cita', chat: 'Chat', correo: 'Correo', whatsapp: 'WhatsApp',
  llamada: 'Llamada', presencial: 'Presencial', referido: 'Referido',
}
const CONFLICTO: Record<string, string> = { pendiente: 'Pendiente de revisar', sin_conflicto: 'Sin conflicto', con_conflicto: 'Con conflicto' }
const ACCION: Record<string, string> = {
  crear: 'Creación', actualizar: 'Actualización', cambiar_estado: 'Cambio de estado', cerrar: 'Cierre', reabrir: 'Reapertura',
  ver_reservado: 'Acceso a caso reservado',
  revisar_conflicto: 'Revisión de conflictos', proponer_asignacion: 'Equipo propuesto', aprobar_asignacion: 'Asignación aprobada',
  autorizar_capacidad: 'Asignación aprobada sobre capacidad', confirmar_asignacion: 'Asignación confirmada',
  rechazar_asignacion: 'Asignación rechazada', reasignar: 'Titular reasignado',
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-montserrat text-[10px] uppercase tracking-widest text-text-muted">{etiqueta}</dt>
      <dd className="mt-1 break-words font-montserrat text-sm text-text-light">{children}</dd>
    </div>
  )
}

export default async function SolicitudPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; aviso?: string }> }) {
  const personal = await personalDePagina(['direccion', 'coordinacion', 'asistencia', 'asociado', 'externo'])
  const { id } = await params
  const { tab, aviso } = await searchParams
  if (!uuidSchema.safeParse(id).success) notFound()

  let detalle: DetalleSolicitud | null | undefined
  try {
    detalle = await detalleSolicitud(personal, id)
  } catch {
    detalle = undefined
  }
  if (detalle === undefined) redirect('/admin/crm')
  if (detalle === null) notFound() // no existe o no le corresponde verla

  const { solicitud: s, contacto, empresa, historial, registro, estados_permitidos, permisos, solo_lectura, nivel } = detalle
  const completa = nivel === 'completo' || nivel === 'sin_juridico'
  // Pestañas según el nivel (4.2): expediente solo con acceso completo; el externo ve resumen y su cronología.
  const pestanas: [string, string][] = completa
    ? [['resumen', 'Resumen'], ['equipo', 'Equipo'], ['cronologia', 'Cronología'], ['citas', 'Citas'],
      ...(puedeVerExpediente(nivel) ? [['expediente', 'Expediente'] as [string, string]] : []), ['historial', 'Historial']]
    : nivel === 'reducido' ? [['resumen', 'Resumen'], ['cronologia', 'Cronología']] : []
  const pestana = pestanas.some(([c]) => c === tab) ? (tab as string) : 'resumen'
  const estado = s.estado as Estado
  const rol = personal.rol
  const cerrada = estado === 'cerrada'
  const admiteEquipo = ['aceptada_pendiente_asignacion', 'asignada', 'en_curso', 'en_espera'].includes(estado)
  const admiteReasignar = ['asignada', 'en_curso', 'en_espera'].includes(estado)
  const abierta = !cerrada && estado !== 'descartada'

  // ── Entrega 4: citas, cronología y expediente ──────────────────────────────
  const puedeAgendar = abierta && puedeGestionarCitasDe(personal, nivel)
  let citas: Awaited<ReturnType<typeof citasParaPantalla>> = []
  let expediente: { valores: Record<string, string | null>; updatedAt: string | null; editable: boolean } | null = null
  if (pestana === 'citas') {
    try {
      citas = await citasParaPantalla(personal, await listarCitas(personal, { solicitudId: s.id }))
    } catch {
      redirect('/admin/crm')
    }
  }
  if (pestana === 'expediente') {
    try {
      const ex = await obtenerExpediente(s.id)
      const titular = await esTitularActivo(personal.id, s.id)
      expediente = {
        valores: Object.fromEntries(CAMPOS_EXPEDIENTE.map((c) => [c, ex?.[c] ?? null])),
        updatedAt: ex?.updated_at ?? null,
        editable: !cerrada && puedeEditarExpediente(personal, titular),
      }
    } catch {
      redirect('/admin/crm')
    }
  }
  const avisoE4 = aviso ? AVISO_E4[aviso] : undefined

  let miembros: MiembroVista[] = []
  if (pestana === 'equipo') {
    try {
      miembros = (await equipoDeSolicitud(s.id)).map((m) => ({
        id: m.id, personal_id: m.personal_id, nombre: m.nombre, rol: m.rol,
        rol_etiqueta: ETIQUETA_ROL_EQUIPO[m.rol as keyof typeof ETIQUETA_ROL_EQUIPO] ?? m.rol,
        estado: m.estado, estado_etiqueta: ETIQUETA_ESTADO_EQUIPO[m.estado] ?? m.estado,
        funciones: m.funciones, carga: m.carga, capacidad: m.capacidad,
        supera_capacidad: m.supera_capacidad, motivo_supera_capacidad: m.motivo_supera_capacidad, motivo_rechazo: m.motivo_rechazo,
      }))
    } catch {
      redirect('/admin/crm')
    }
  }

  return (
    <div className="space-y-8 px-6 pb-16 pt-8">
      <div className="border-b border-border pb-6">
        <Link href="/admin/crm/solicitudes" className="focus-gold font-montserrat text-[10px] uppercase tracking-widest text-text-muted hover:text-gold">← Solicitudes</Link>
        <h1 className="mt-2 font-cinzel text-3xl font-bold uppercase tracking-wider text-gold">{s.codigo}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
          <IndicadorEstado etiqueta={ETIQUETA_ESTADO[estado] ?? s.estado} fase={FASE_ESTADO[estado] ?? 'terminado'} />
          <IndicadorUrgencia urgencia={s.urgencia} />
          {s.reserva_reforzada && <span className="font-montserrat text-xs text-gold">Reserva reforzada</span>}
          {s.requiere_validacion && <span className="font-montserrat text-xs text-text-muted">Por validar</span>}
        </p>
      </div>

      <SolicitudAcciones
        solicitudId={s.id}
        codigo={s.codigo}
        updatedAt={s.updated_at}
        reservada={s.reserva_reforzada}
        estados={estados_permitidos}
        permisos={permisos}
        soloLectura={solo_lectura}
        aviso={aviso === 'creada' || aviso === 'editada' ? aviso : undefined}
      />

      {nivel === 'resumen' && (
        <p className="border border-gold/40 bg-gold/5 px-4 py-3 font-montserrat text-xs leading-relaxed text-gold">
          Tienes una asignación por confirmar en este caso. Solo ves el resumen del caso hasta que la confirmes.{' '}
          <Link href="/admin/crm/asignaciones" className="focus-gold underline underline-offset-2">Ir a Mis asignaciones</Link>
        </p>
      )}

      {avisoE4 && <Franja tipo="exito">{avisoE4}</Franja>}

      {pestanas.length > 0 && (
        <nav aria-label="Secciones de la solicitud" className="flex flex-wrap gap-x-6 gap-y-2 border-b border-border">
          {pestanas.map(([clave, etiqueta]) => (
            <Link
              key={clave}
              href={`/admin/crm/solicitudes/${s.id}?tab=${clave}`}
              aria-current={pestana === clave ? 'page' : undefined}
              className={`focus-gold -mb-px border-b-2 pb-3 font-montserrat text-xs font-medium uppercase tracking-widest transition-colors ${
                pestana === clave ? 'border-gold text-gold' : 'border-transparent text-text-muted hover:text-gold/80'
              }`}
            >
              {etiqueta}
            </Link>
          ))}
        </nav>
      )}

      {pestana === 'resumen' && (
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
          <Dato etiqueta="Contacto">
            {contacto === null
              ? <span className="text-text-muted">Los datos del contacto no están disponibles para tu rol.</span>
              : 'reservado' in contacto
                ? <span className="text-text-muted">Contacto reservado</span>
                : <Link href={`/admin/crm/contactos/${contacto.id}`} className="focus-gold text-gold underline-offset-2 hover:underline">{contacto.nombre}</Link>}
          </Dato>
          {empresa && (
            <Dato etiqueta="En nombre de">
              {'reservado' in empresa ? <span className="text-text-muted">Contacto reservado</span> : <Link href={`/admin/crm/contactos/${empresa.id}`} className="focus-gold text-gold underline-offset-2 hover:underline">{empresa.nombre}</Link>}
            </Dato>
          )}
          {completa && <Dato etiqueta="Canal">{CANAL[s.canal_origen] ?? s.canal_origen}</Dato>}
          <Dato etiqueta="Área">{s.area ?? '—'}</Dato>
          <Dato etiqueta="Servicio">{s.servicio ?? '—'}</Dato>
          {completa && <Dato etiqueta="Modalidad">{s.modalidad ?? '—'}</Dato>}
          {completa && <Dato etiqueta="Recibida">{formatoFechaHora(s.fecha_recepcion)}</Dato>}
          {completa && <Dato etiqueta="Primera respuesta">{s.primera_respuesta_at ? formatoFechaHora(s.primera_respuesta_at) : 'Sin responder'}</Dato>}
          {completa && <Dato etiqueta="Revisión de conflictos">{CONFLICTO[s.conflicto_revision] ?? s.conflicto_revision}</Dato>}
          {completa && s.motivo_estado && <Dato etiqueta="Motivo del último cambio">{s.motivo_estado}</Dato>}
          {completa && s.resultado_cierre && <Dato etiqueta="Resultado del cierre">{s.resultado_cierre}</Dato>}
          {completa && s.pendientes_cierre && <Dato etiqueta="Pendientes de cumplimiento">{s.pendientes_cierre}</Dato>}
          <div className="sm:col-span-2 xl:col-span-3"><Dato etiqueta="Descripción"><span className="whitespace-pre-wrap">{s.descripcion}</span></Dato></div>
          {completa && s.objetivo_cliente && <div className="sm:col-span-2 xl:col-span-3"><Dato etiqueta="Qué busca el cliente"><span className="whitespace-pre-wrap">{s.objetivo_cliente}</span></Dato></div>}
        </dl>
      )}

      {pestana === 'equipo' && (
        <EquipoPanel
          solicitudId={s.id}
          codigo={s.codigo}
          conflicto={{ valor: s.conflicto_revision, etiqueta: CONFLICTO[s.conflicto_revision] ?? s.conflicto_revision }}
          admiteEquipo={admiteEquipo}
          admiteReasignar={admiteReasignar}
          puedeConflicto={abierta && (rol === 'direccion' || rol === 'coordinacion')}
          puedeProponer={abierta && (rol === 'direccion' || rol === 'coordinacion')}
          puedeAprobar={abierta && rol === 'direccion'}
          puedeFinalizar={abierta && (rol === 'direccion' || rol === 'coordinacion')}
          puedeReasignar={abierta && rol === 'direccion'}
          soloLectura={cerrada}
          miembros={miembros}
          motivosReasignacion={Object.entries(ETIQUETA_MOTIVO_REASIGNACION).map(([valor, etiqueta]) => ({ valor, etiqueta }))}
        />
      )}

      {pestana === 'cronologia' && (
        <CronologiaPanel
          solicitudId={s.id}
          puedeRegistrar={!cerrada && puedeCrearActividad(personal, nivel, { tipo: rol === 'externo' ? 'nota' : 'llamada', es_juridica: false, es_plazo_juridico: false })}
          permiteJuridico={recibeJuridicas(rol) && (nivel === 'completo' || nivel === 'reducido')}
          soloNotas={rol === 'externo'}
          puedeCrearTareas={!cerrada && puedeCrearActividad(personal, nivel, { tipo: 'tarea', es_juridica: false, es_plazo_juridico: false })}
        />
      )}

      {pestana === 'citas' && (
        <div className="space-y-4">
          {puedeAgendar && (
            <Link href={`/admin/crm/citas/nueva?solicitud=${s.id}`} className={BOTON_BARRA}>+ Agendar cita</Link>
          )}
          <CitasLista
            citas={citas}
            vacio={puedeAgendar ? 'Este caso no tiene citas. Usa «Agendar cita» para crear la primera.' : 'Este caso no tiene citas.'}
          />
          {puedeAgendar && citas.some((c) => c.estado === 'cancelada') && (
            <div className="font-montserrat text-xs text-text-muted">
              <p>Para reemplazar una cita cancelada (la nueva quedará vinculada a ella):</p>
              <ul className="mt-2 list-inside list-disc">
                {citas.filter((c) => c.estado === 'cancelada').slice(-5).map((c) => (
                  <li key={c.id}>
                    {c.fecha} {c.hora}{' — '}
                    <Link href={`/admin/crm/citas/nueva?solicitud=${s.id}&reagendada_de=${c.id}`} className="focus-gold text-gold underline underline-offset-2">Agendar una nueva en su lugar</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {pestana === 'expediente' && expediente && (
        <ExpedienteForm solicitudId={s.id} inicial={expediente.valores} updatedAt={expediente.updatedAt} editable={expediente.editable} />
      )}

      {pestana === 'historial' && (
        <div className="space-y-8">
          <section aria-labelledby="hist-estados">
            <h2 id="hist-estados" className="font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80">Cambios de estado</h2>
            {historial.length === 0 ? (
              <p className="mt-3 font-montserrat text-xs text-text-muted">Aún no hay cambios de estado.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border border border-border bg-card-bg">
                {historial.map((h) => (
                  <li key={h.id} className="px-5 py-3 font-montserrat text-xs">
                    <p className="text-text-light">
                      {h.estado_anterior ? `${ETIQUETA_ESTADO[h.estado_anterior as Estado] ?? h.estado_anterior} → ` : 'Creada como '}
                      <span className="text-gold">{ETIQUETA_ESTADO[h.estado_nuevo as Estado] ?? h.estado_nuevo}</span>
                    </p>
                    <p className="mt-1 text-text-muted">{formatoFechaHora(h.created_at)} · {h.usuario ?? 'Automático'}{h.motivo ? ` · ${h.motivo}` : ''}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {registro.length > 0 && (
            <section aria-labelledby="hist-registro">
              <h2 id="hist-registro" className="font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80">Registro de acciones</h2>
              <ul className="mt-3 divide-y divide-border border border-border bg-card-bg">
                {registro.map((r) => (
                  <li key={r.id} className="px-5 py-3 font-montserrat text-xs">
                    <p className="text-text-light">{ACCION[r.accion] ?? r.accion.replace(/_/g, ' ')}</p>
                    <p className="mt-1 text-text-muted">{formatoFechaHora(r.created_at)} · {r.usuario ?? 'Automático'}{r.motivo ? ` · ${r.motivo}` : ''}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
