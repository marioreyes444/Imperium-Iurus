import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import ContactoAcciones from '@/components/crm/ContactoAcciones'
import Indicador from '@/components/crm/Indicador'
import { formatoFecha, formatoFechaHora } from '@/components/crm/formato'
import { personalDePagina } from '@/lib/crm/permisos'
import { uuidSchema } from '@/lib/crm/schemas'
import { detalleContacto, type DetalleContacto } from '@/lib/crm/detalles'
import { ETIQUETA_ETAPA } from '@/lib/crm/contactos'
import { ETIQUETA_ESTADO, FASE_ESTADO, type Estado } from '@/lib/crm/estados'

export const dynamic = 'force-dynamic'

const RELLENO_FASE = { por_atender: 'contorno', en_tramite: 'dorado', activo: 'claro', terminado: 'atenuado' } as const

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-montserrat text-[10px] uppercase tracking-widest text-text-muted">{etiqueta}</dt>
      <dd className="mt-1 break-words font-montserrat text-sm text-text-light">{children}</dd>
    </div>
  )
}

export default async function ContactoPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ aviso?: string }> }) {
  const personal = await personalDePagina(['direccion', 'coordinacion', 'asistencia', 'asociado'])
  const { id } = await params
  const { aviso } = await searchParams
  if (!uuidSchema.safeParse(id).success) notFound()

  let detalle: DetalleContacto | null | undefined
  try {
    detalle = await detalleContacto(personal, id)
  } catch {
    detalle = undefined
  }
  if (detalle === undefined) redirect('/admin/crm') // módulo no disponible o error
  if (detalle === null) notFound() // no existe o no le corresponde verlo

  const { contacto: c, vinculados, solicitudes, duplicados, permisos } = detalle

  return (
    <div className="space-y-8 px-6 pb-16 pt-8">
      <div className="border-b border-border pb-6">
        <Link href="/admin/crm/contactos" className="focus-gold font-montserrat text-[10px] uppercase tracking-widest text-text-muted hover:text-gold">← Contactos</Link>
        <h1 className="mt-2 font-cinzel text-3xl font-bold uppercase tracking-wider text-gold">{c.nombre}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-montserrat text-xs text-text-muted">
          <span>{c.tipo === 'empresa' ? 'Empresa' : 'Persona'}</span>
          <Indicador forma="punto" relleno="dorado" texto={ETIQUETA_ETAPA[c.etapa_relacion] ?? c.etapa_relacion} />
          {c.reserva_reforzada && <span className="text-gold">Reserva reforzada</span>}
          {c.fusionado_en && <span>Ficha fusionada</span>}
        </p>
        {c.completar_apellidos && permisos.editar && (
          <p className="mt-3 font-montserrat text-xs text-text-muted">
            Falta separar los apellidos.{' '}
            <Link href={`/admin/crm/contactos/${c.id}/editar`} className="focus-gold text-gold underline-offset-2 hover:underline">Completar apellidos</Link>
          </p>
        )}
      </div>

      <ContactoAcciones
        contactoId={c.id}
        tipo={c.tipo}
        updatedAt={c.updated_at}
        reservada={c.reserva_reforzada}
        noContinua={c.etapa_relacion === 'no_continua'}
        permisos={permisos}
        vinculados={vinculados}
        aviso={aviso === 'creado' || aviso === 'editado' ? aviso : undefined}
      />

      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        <Dato etiqueta="Identificación">
          {c.identificacion ? (
            <>
              {c.tipo_identificacion} {c.identificacion}
              {c.no_validado && <span className="ml-2 text-xs text-text-muted">· no validado</span>}
            </>
          ) : '—'}
        </Dato>
        <Dato etiqueta="Teléfono">{c.telefono ?? '—'}</Dato>
        <Dato etiqueta="Correo">{c.correo ?? '—'}</Dato>
        <Dato etiqueta="Ciudad">{c.ciudad ?? '—'}</Dato>
        <Dato etiqueta="Dirección">{c.direccion ?? '—'}</Dato>
        <Dato etiqueta="Preferencia">{c.preferencia_comunicacion ?? '—'}</Dato>
        {c.tipo === 'persona' && <Dato etiqueta="Ocupación">{c.ocupacion ?? '—'}</Dato>}
        {c.tipo === 'empresa' && <Dato etiqueta="Nombre comercial">{c.nombre_comercial ?? '—'}</Dato>}
        {c.tipo === 'empresa' && <Dato etiqueta="Sector">{c.sector ?? '—'}</Dato>}
        <Dato etiqueta="Primer contacto">{c.canal_primer_contacto ?? '—'}</Dato>
        <Dato etiqueta="Cómo nos conoció">{c.como_nos_conocio ?? '—'}</Dato>
        <Dato etiqueta="Alta">{formatoFechaHora(c.created_at)}</Dato>
        {c.etapa_relacion === 'no_continua' && <Dato etiqueta="Motivo «no continúa»">{c.motivo_no_continua ?? '—'}</Dato>}
        {c.notas_internas && <div className="sm:col-span-2 xl:col-span-3"><Dato etiqueta="Notas internas"><span className="whitespace-pre-wrap">{c.notas_internas}</span></Dato></div>}
      </dl>

      <section aria-labelledby="ct-solicitudes">
        <h2 id="ct-solicitudes" className="font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80">Solicitudes</h2>
        {solicitudes.length === 0 ? (
          <p className="mt-3 font-montserrat text-xs leading-relaxed text-text-muted">Este contacto no tiene solicitudes visibles para ti.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border border border-border bg-card-bg">
            {solicitudes.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 px-5 py-3 font-montserrat text-xs">
                <Link href={`/admin/crm/solicitudes/${s.id}`} className="focus-gold text-text-light hover:text-gold">{s.codigo}</Link>
                <Indicador forma="punto" relleno={RELLENO_FASE[FASE_ESTADO[s.estado as Estado] ?? 'terminado']} texto={ETIQUETA_ESTADO[s.estado as Estado] ?? s.estado} />
                <span className="text-text-muted">{formatoFecha(s.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {duplicados.length > 0 && (
        <section aria-labelledby="ct-duplicados">
          <h2 id="ct-duplicados" className="font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80">Posibles duplicados pendientes</h2>
          <ul className="mt-3 divide-y divide-border border border-border bg-card-bg">
            {duplicados.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-4 px-5 py-3 font-montserrat text-xs">
                <span className="text-text-muted">{d.coincidencia === 'correo' ? 'Mismo correo' : d.coincidencia === 'telefono' ? 'Mismo teléfono' : 'Mismo nombre'}</span>
                <Link href={`/admin/crm/duplicados/${d.id}`} className="focus-gold text-gold underline-offset-2 hover:underline">Comparar</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
