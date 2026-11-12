import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import SolicitudAcciones from '@/components/crm/SolicitudAcciones'
import { IndicadorEstado, IndicadorUrgencia } from '@/components/crm/IndicadoresSolicitud'
import { formatoFechaHora } from '@/components/crm/formato'
import { personalDePagina } from '@/lib/crm/permisos'
import { uuidSchema } from '@/lib/crm/schemas'
import { detalleSolicitud, type DetalleSolicitud } from '@/lib/crm/detalles'
import { ETIQUETA_ESTADO, FASE_ESTADO, type Estado } from '@/lib/crm/estados'

export const dynamic = 'force-dynamic'

const CANAL: Record<string, string> = {
  web: 'Formulario web', cita: 'Reserva de cita', chat: 'Chat', correo: 'Correo', whatsapp: 'WhatsApp',
  llamada: 'Llamada', presencial: 'Presencial', referido: 'Referido',
}
const CONFLICTO: Record<string, string> = { pendiente: 'Pendiente de revisar', sin_conflicto: 'Sin conflicto', con_conflicto: 'Con conflicto' }
const ACCION: Record<string, string> = {
  crear: 'Creación', actualizar: 'Actualización', cambiar_estado: 'Cambio de estado', cerrar: 'Cierre', reabrir: 'Reapertura',
  ver_reservado: 'Acceso a caso reservado',
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
  const pestana = completa && tab === 'historial' ? 'historial' : 'resumen'
  const estado = s.estado as Estado

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

      {completa && (
        <nav aria-label="Secciones de la solicitud" className="flex gap-6 border-b border-border">
          {([['resumen', 'Resumen'], ['historial', 'Historial']] as const).map(([clave, etiqueta]) => (
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
          <Dato etiqueta="Canal">{CANAL[s.canal_origen] ?? s.canal_origen}</Dato>
          <Dato etiqueta="Área">{s.area ?? '—'}</Dato>
          <Dato etiqueta="Servicio">{s.servicio ?? '—'}</Dato>
          <Dato etiqueta="Modalidad">{s.modalidad ?? '—'}</Dato>
          <Dato etiqueta="Recibida">{formatoFechaHora(s.fecha_recepcion)}</Dato>
          {completa && <Dato etiqueta="Primera respuesta">{s.primera_respuesta_at ? formatoFechaHora(s.primera_respuesta_at) : 'Sin responder'}</Dato>}
          {completa && <Dato etiqueta="Revisión de conflictos">{CONFLICTO[s.conflicto_revision] ?? s.conflicto_revision}</Dato>}
          {s.motivo_estado && <Dato etiqueta="Motivo del último cambio">{s.motivo_estado}</Dato>}
          {s.resultado_cierre && <Dato etiqueta="Resultado del cierre">{s.resultado_cierre}</Dato>}
          {s.pendientes_cierre && <Dato etiqueta="Pendientes de cumplimiento">{s.pendientes_cierre}</Dato>}
          <div className="sm:col-span-2 xl:col-span-3"><Dato etiqueta="Descripción"><span className="whitespace-pre-wrap">{s.descripcion}</span></Dato></div>
          {s.objetivo_cliente && <div className="sm:col-span-2 xl:col-span-3"><Dato etiqueta="Qué busca el cliente"><span className="whitespace-pre-wrap">{s.objetivo_cliente}</span></Dato></div>}
        </dl>
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
