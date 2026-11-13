import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { personalDePagina, puedeVerHorario } from '@/lib/crm/permisos'
import { ROL_LABEL, esRol } from '@/lib/crm/roles'
import { uuidSchema } from '@/lib/crm/schemas'
import { areasDe, cargaDe, obtenerFicha, puedeEditarFicha, puedeVerFicha } from '@/lib/crm/personal'
import { obtenerCatalogo } from '@/lib/crm/catalogo'
import { formatoFecha } from '@/components/crm/formato'
import { BOTON_BARRA } from '@/components/crm/estilos'

export const dynamic = 'force-dynamic'

const REFERENCIA: Record<string, string> = { titular: 'Titular de referencia', suplente: 'Suplente de referencia', miembro: 'Miembro' }

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-montserrat text-[10px] uppercase tracking-widest text-text-muted">{etiqueta}</dt>
      <dd className="mt-1 break-words font-montserrat text-sm text-text-light">{children}</dd>
    </div>
  )
}

/** Ficha de una persona del personal. Dirección y Coordinación ven todas; el resto, solo la suya. */
export default async function FichaPersonalPage({ params }: { params: Promise<{ id: string }> }) {
  const personal = await personalDePagina()
  const { id } = await params
  if (!uuidSchema.safeParse(id).success || !puedeVerFicha(personal, id)) notFound()

  let ficha
  try {
    ficha = await obtenerFicha(id)
  } catch {
    redirect('/admin/crm')
  }
  if (!ficha) notFound()

  const [carga, areas, catalogo] = await Promise.all([cargaDe(id), areasDe(id), obtenerCatalogo()])
  const nombreArea = (areaId: string) => catalogo.areas.find((a) => a.id === areaId)?.nombre ?? 'Área'
  const verLista = personal.rol === 'direccion' || personal.rol === 'coordinacion'

  return (
    <div className="space-y-8 px-6 pb-16 pt-8">
      <div className="border-b border-border pb-6">
        {verLista && <Link href="/admin/crm/personal" className="focus-gold font-montserrat text-[10px] uppercase tracking-widest text-text-muted hover:text-gold">← Personal</Link>}
        <h1 className="mt-2 font-cinzel text-3xl font-bold uppercase tracking-wider text-gold">{ficha.nombres} {ficha.apellidos}</h1>
        <p className="mt-2 font-montserrat text-xs text-text-muted">
          {esRol(ficha.rol) ? ROL_LABEL[ficha.rol] : ficha.rol}{!ficha.activo && ' · Inactivo'}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {puedeEditarFicha(personal) && <Link href={`/admin/crm/personal/${id}/editar`} className={BOTON_BARRA}>Editar</Link>}
          {puedeVerHorario(personal, id) && <Link href={`/admin/crm/personal/${id}/horario`} className={BOTON_BARRA}>Horario y ausencias</Link>}
        </div>
      </div>

      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        <Dato etiqueta="Correo">{ficha.correo ?? '—'}</Dato>
        <Dato etiqueta="Teléfono">{ficha.telefono ?? '—'}</Dato>
        <Dato etiqueta="Ciudad">{ficha.ciudad ?? '—'}</Dato>
        <Dato etiqueta="Abogado">{ficha.es_abogado ? 'Sí' : 'No'}</Dato>
        <Dato etiqueta="Matrícula">{ficha.matricula ?? '—'}</Dato>
        <Dato etiqueta="Habilitación">
          {ficha.es_abogado
            ? (ficha.habilitacion_verificada ? `Verificada${ficha.habilitacion_verificada_at ? ` el ${formatoFecha(ficha.habilitacion_verificada_at)}` : ''}` : 'Sin verificar')
            : '—'}
        </Dato>
        <Dato etiqueta="Especialidad">{ficha.especialidad ?? '—'}</Dato>
        <Dato etiqueta="Capacidad máxima (casos como titular)">{ficha.capacidad_maxima ?? 'Sin límite definido'}</Dato>
        <Dato etiqueta="Vinculación">{ficha.fecha_vinculacion ? formatoFecha(`${ficha.fecha_vinculacion}T12:00:00-05:00`) : '—'}</Dato>
        <Dato etiqueta="Acuerdo de confidencialidad">{ficha.acuerdo_confidencialidad ? 'Firmado' : 'No firmado'}</Dato>
      </dl>

      {carga && (
        <section aria-labelledby="carga">
          <h2 id="carga" className="font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80">Carga actual</h2>
          <dl className="mt-3 grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
            <Dato etiqueta="Casos como titular">{carga.carga_titular}{ficha.capacidad_maxima !== null ? ` de ${ficha.capacidad_maxima}` : ''}</Dato>
            <Dato etiqueta="Casos de apoyo">{carga.casos_apoyo}</Dato>
            <Dato etiqueta="Tareas vencidas">{carga.tareas_vencidas}</Dato>
            <Dato etiqueta="Tareas en 7 días">{carga.tareas_7_dias}</Dato>
          </dl>
        </section>
      )}

      {ficha.es_abogado && (
        <section aria-labelledby="areas">
          <h2 id="areas" className="font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80">Áreas de referencia</h2>
          <p className="mt-1 font-montserrat text-[11px] text-text-muted">Sirven para ordenar las sugerencias de asignación; no dan acceso a ningún caso.</p>
          {areas.length === 0 ? (
            <p className="mt-3 font-montserrat text-xs text-text-muted">Sin áreas vinculadas.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border border border-border bg-card-bg">
              {areas.map((a) => (
                <li key={a.area_id} className="px-5 py-3 font-montserrat text-xs text-text-light">
                  {nombreArea(a.area_id)} <span className="text-text-muted">· {REFERENCIA[a.rol_referencia] ?? a.rol_referencia}{a.competencia_acreditada ? ' · competencia acreditada' : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
