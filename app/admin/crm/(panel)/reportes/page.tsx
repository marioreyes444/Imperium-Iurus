import Franja from '@/components/crm/Franja'
import BarraProporcion from '@/components/crm/BarraProporcion'
import ExportarCsv from '@/components/crm/ExportarCsv'
import { CLASE_ETIQUETA, CLASE_INPUT, BOTON_PRIMARIO } from '@/components/crm/estilos'
import { ACCIONES, CrmNoDisponibleError, personalDePagina } from '@/lib/crm/permisos'
import { CANALES, queryComoObjeto, reportesQuerySchema } from '@/lib/crm/schemas'
import { ExcedeTopeError, generarReporte, type Conteo, type ConteoTexto, type Estadistica, type Reporte } from '@/lib/crm/reportes'
import { obtenerCatalogo } from '@/lib/crm/catalogo'
import { abogadosActivos } from '@/lib/crm/horarios'
import { ETIQUETA_ESTADO, type Estado } from '@/lib/crm/estados'
import { hoyGuayaquil, sumarDias } from '@/lib/crm/fechas'

export const dynamic = 'force-dynamic'

const URGENCIA: Record<string, string> = { critica: 'Crítica', alta: 'Alta', media: 'Media', ordinaria: 'Ordinaria' }
const CANAL: Record<string, string> = {
  web: 'Sitio web', cita: 'Reserva de cita', chat: 'Chat', correo: 'Correo', whatsapp: 'WhatsApp',
  llamada: 'Llamada', presencial: 'Presencial', referido: 'Referido',
}
const COINCIDENCIA: Record<string, string> = { telefono: 'Teléfono', correo: 'Correo', nombre: 'Nombre' }
const ESTADO_DUPLICADO: Record<string, string> = { pendiente: 'Pendiente', fusionado: 'Fusionado', descartado: 'Descartado' }

const TITULO = 'font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80'
const TH = 'px-4 py-2.5 text-left font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-muted'
const TD = 'px-4 py-2.5 font-montserrat text-xs text-text-light'

const num = (n: number) => n.toLocaleString('es-EC')
const horas = (h: number | null) => {
  if (h === null) return '—'
  return h < 48 ? `${h.toLocaleString('es-EC', { maximumFractionDigits: 1 })} h` : `${(h / 24).toLocaleString('es-EC', { maximumFractionDigits: 1 })} días`
}

function Cifra({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  return (
    <div className="border border-border bg-card-bg px-5 py-4">
      <p className="font-cinzel text-2xl font-bold tabular-nums text-gold">{valor}</p>
      <p className="mt-1 font-montserrat text-[10px] uppercase tracking-widest text-text-muted">{etiqueta}</p>
    </div>
  )
}

/** Desglose: etiqueta, número y barra proporcional (el número siempre se escribe). */
function Desglose({ titulo, filas, total, etiquetas }: { titulo: string; filas: Conteo[]; total: number; etiquetas?: Record<string, string> }) {
  return (
    <div className="border border-border bg-card-bg">
      <h3 className="border-b border-border px-4 py-2.5 font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-muted">{titulo}</h3>
      {filas.length === 0 ? (
        <p className="px-4 py-3 font-montserrat text-xs text-text-muted">Sin datos en el período.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {filas.map((f) => (
            <li key={f.clave} className="px-4 py-2.5">
              <div className="flex items-baseline justify-between gap-3 font-montserrat text-xs text-text-light">
                <span className="truncate" title={etiquetas?.[f.clave] ?? f.clave}>{etiquetas?.[f.clave] ?? f.clave}</span>
                <span className="tabular-nums">{num(f.total)}</span>
              </div>
              <div className="mt-1.5"><BarraProporcion valor={f.total} total={total} etiqueta={etiquetas?.[f.clave] ?? f.clave} /></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Textos({ titulo, filas }: { titulo: string; filas: ConteoTexto[] }) {
  return (
    <div className="border border-border bg-card-bg">
      <h3 className="border-b border-border px-4 py-2.5 font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-muted">{titulo}</h3>
      {filas.length === 0 ? (
        <p className="px-4 py-3 font-montserrat text-xs text-text-muted">Sin datos en el período.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {filas.map((f) => (
            <li key={f.texto} className="flex items-baseline justify-between gap-3 px-4 py-2.5 font-montserrat text-xs text-text-light">
              <span className="min-w-0 flex-1 truncate" title={f.texto}>{f.texto}</span>
              <span className="tabular-nums">{num(f.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const mediana = (e: Estadistica) => (e.n === 0 ? '—' : `${horas(e.mediana)} (mediana) · ${horas(e.promedio)} (promedio)`)

function Contenido({ r }: { r: Reporte }) {
  const total = r.solicitudes.total
  return (
    <div className="space-y-10">
      <section aria-labelledby="rep-solicitudes" className="space-y-4">
        <h2 id="rep-solicitudes" className={TITULO}>Solicitudes recibidas</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Cifra valor={num(total)} etiqueta="Solicitudes en el período" />
          <Cifra valor={num(r.embudo.propuestas)} etiqueta="Con propuesta enviada" />
          <Cifra valor={num(r.embudo.contrataciones)} etiqueta="Contrataciones (encargo aceptado)" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Desglose titulo="Por estado actual" total={total} filas={r.solicitudes.por_estado} etiquetas={ETIQUETA_ESTADO as Record<string, string>} />
          <Desglose titulo="Por canal" total={total} filas={r.solicitudes.por_canal} etiquetas={CANAL} />
          <Desglose titulo="Por urgencia" total={total} filas={r.solicitudes.por_urgencia} etiquetas={URGENCIA} />
          <Desglose titulo="Por área" total={total} filas={r.solicitudes.por_area} />
        </div>
        <p className="font-montserrat text-[11px] text-text-muted">
          Propuestas y contrataciones cuentan las solicitudes que cambiaron de estado dentro del período, sin importar cuándo se recibieron.
        </p>
      </section>

      <section aria-labelledby="rep-contactos" className="space-y-4">
        <h2 id="rep-contactos" className={TITULO}>Contactos nuevos y duplicados</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Cifra valor={num(r.contactos.nuevos)} etiqueta="Contactos nuevos" />
          <Cifra valor={num(r.contactos.duplicados.total)} etiqueta="Posibles duplicados detectados" />
          <Cifra valor={num(r.contactos.duplicados.por_estado.find((d) => d.clave === 'pendiente')?.total ?? 0)} etiqueta="Duplicados por revisar" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Desglose titulo="Contactos nuevos por canal" total={r.contactos.nuevos} filas={r.contactos.por_canal} etiquetas={CANAL} />
          <Desglose titulo="Duplicados por estado" total={r.contactos.duplicados.total} filas={r.contactos.duplicados.por_estado} etiquetas={ESTADO_DUPLICADO} />
          <Desglose titulo="Duplicados por coincidencia" total={r.contactos.duplicados.total} filas={r.contactos.duplicados.por_coincidencia} etiquetas={COINCIDENCIA} />
        </div>
        <p className="font-montserrat text-[11px] text-text-muted">
          Los contactos y los duplicados no dependen del área ni del responsable: esos filtros no los afectan.
        </p>
      </section>

      <section aria-labelledby="rep-citas" className="space-y-4">
        <h2 id="rep-citas" className={TITULO}>Consultas agendadas y atendidas</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Cifra valor={num(r.citas.total)} etiqueta="Citas en el período" />
          <Cifra valor={num(r.citas.vigentes)} etiqueta="Pendientes o confirmadas" />
          <Cifra valor={num(r.citas.atendidas)} etiqueta="Atendidas" />
          <Cifra valor={num(r.citas.no_asistio)} etiqueta="No asistió" />
          <Cifra valor={num(r.citas.canceladas)} etiqueta="Canceladas" />
        </div>
        <p className="font-montserrat text-xs text-text-muted">
          Asistencia: {r.citas.pct_asistencia === null ? 'todavía no hay citas marcadas como atendidas o no asistió.' : `${r.citas.pct_asistencia.toLocaleString('es-EC', { maximumFractionDigits: 0 })} % de las citas concluidas fueron atendidas.`}
          {' '}Con un responsable elegido se cuenta por el abogado de la cita.
        </p>
      </section>

      <section aria-labelledby="rep-respuesta" className="space-y-4">
        <h2 id="rep-respuesta" className={TITULO}>Tiempo de primera respuesta</h2>
        <div className="overflow-x-auto border border-border bg-card-bg">
          <table className="w-full min-w-[720px] border-collapse">
            <caption className="sr-only">Primera respuesta por urgencia, en horas hábiles</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={TH}>Urgencia</th>
                <th scope="col" className={TH}>Recibidas</th>
                <th scope="col" className={TH}>Respondidas</th>
                <th scope="col" className={TH}>Tiempo (horas hábiles)</th>
                <th scope="col" className={TH}>Objetivo cumplido</th>
                <th scope="col" className={TH}>Incumplido</th>
                <th scope="col" className={TH}>En curso</th>
              </tr>
            </thead>
            <tbody>
              {r.primera_respuesta.map((f) => (
                <tr key={f.urgencia} className="border-b border-border/60">
                  <th scope="row" className={`${TD} text-left font-medium`}>{URGENCIA[f.urgencia] ?? f.urgencia}</th>
                  <td className={`${TD} tabular-nums`}>{num(f.recibidas)}</td>
                  <td className={`${TD} tabular-nums`}>{num(f.con_respuesta)}</td>
                  <td className={TD}>{mediana(f.horas_habiles)}</td>
                  <td className={`${TD} tabular-nums`}>{num(f.cumplidas)}</td>
                  <td className={`${TD} tabular-nums ${f.incumplidas > 0 ? 'font-semibold text-red-400' : ''}`}>{num(f.incumplidas)}</td>
                  <td className={`${TD} tabular-nums`}>{num(f.en_curso)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="font-montserrat text-[11px] text-text-muted">
          Horas hábiles supuestas: lunes a viernes, 09:00–18:00, sin feriados. Objetivos: crítica 60 minutos corridos; alta 2 h; media 8 h; ordinaria 9 h hábiles.
          Una solicitud sin respuesta cuenta como incumplida si el plazo ya venció y «en curso» si todavía no.
        </p>
      </section>

      <section aria-labelledby="rep-asignacion" className="space-y-4">
        <h2 id="rep-asignacion" className={TITULO}>Tiempo de asignación</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Cifra valor={num(r.asignacion.casos)} etiqueta="Casos con titular confirmado en el período" />
          <Cifra valor={r.asignacion.horas.n === 0 ? '—' : horas(r.asignacion.horas.mediana)} etiqueta="Mediana desde «aceptada» hasta titular activo" />
        </div>
        <p className="font-montserrat text-[11px] text-text-muted">
          Promedio: {horas(r.asignacion.horas.promedio)}. Se mide en horas corridas, desde la primera vez que el encargo quedó aceptado pendiente de asignación hasta que el titular lo confirmó.
        </p>
      </section>

      <section aria-labelledby="rep-tareas" className="space-y-4">
        <h2 id="rep-tareas" className={TITULO}>Tareas vencidas</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Cifra valor={num(r.tareas.vencidas_pendientes)} etiqueta="Vencidas y sin completar" />
          <Cifra valor={num(r.tareas.plazos_juridicos_vencidos)} etiqueta="De ellas, plazos jurídicos" />
          <Cifra valor={num(r.tareas.completadas_tarde)} etiqueta="Completadas después de vencer" />
        </div>
      </section>

      <section aria-labelledby="rep-cierres" className="space-y-4">
        <h2 id="rep-cierres" className={TITULO}>Cierres y descartes</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Cifra valor={num(r.cierres.total)} etiqueta="Casos cerrados en el período" />
          <Cifra valor={num(r.descartes.total)} etiqueta="Solicitudes descartadas en el período" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Textos titulo="Cierres por resultado" filas={r.cierres.por_resultado} />
          <Textos titulo="Motivos de descarte" filas={r.descartes.motivos} />
        </div>
        <p className="font-montserrat text-[11px] text-text-muted">
          Cerrar un caso no significa que haya salido bien: el desglose muestra el resultado que se escribió al cerrarlo. Los textos se agrupan sin distinguir mayúsculas, tildes ni espacios repetidos (los 20 más frecuentes; el resto, en «Otros»).
        </p>
      </section>
    </div>
  )
}

type Params = { desde?: string; hasta?: string; area?: string; canal?: string; responsable?: string }

export default async function ReportesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const personal = await personalDePagina(ACCIONES['reportes.ver'])
  const p = await searchParams

  const hoy = hoyGuayaquil()
  const crudo = queryComoObjeto(new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => typeof e[1] === 'string')))
  const entrada: Params & { desde: string; hasta: string } = { ...crudo, desde: crudo.desde ?? sumarDias(hoy, -29), hasta: crudo.hasta ?? hoy }
  const parsed = reportesQuerySchema.safeParse(entrada)

  const [catalogo, abogados] = await Promise.all([obtenerCatalogo(), abogadosActivos().catch(() => [])])

  let reporte: Reporte | null = null
  let aviso: { tipo: 'error' | 'info'; texto: string } | null = null
  if (!parsed.success) {
    aviso = { tipo: 'error', texto: parsed.error.issues.map((i) => i.message).join(' · ') }
  } else {
    try {
      reporte = await generarReporte(personal, parsed.data)
    } catch (e) {
      if (e instanceof ExcedeTopeError) {
        aviso = { tipo: 'error', texto: `El período trae demasiados datos para el bloque «${e.bloque}» (más de ${num(e.tope)} filas). Acorta el período o agrega filtros.` }
      } else if (e instanceof CrmNoDisponibleError) {
        aviso = { tipo: 'info', texto: 'Los datos del CRM aún no están disponibles en este entorno (faltan las migraciones de la base).' }
      } else {
        console.error('[admin/crm/reportes]', e instanceof Error ? e.name : 'error')
        aviso = { tipo: 'error', texto: 'No se pudo generar el reporte. Inténtalo de nuevo.' }
      }
    }
  }

  const consulta = new URLSearchParams()
  for (const k of ['desde', 'hasta', 'area', 'canal', 'responsable'] as const) {
    const v = entrada[k]
    if (v) consulta.set(k, v)
  }

  return (
    <div className="space-y-8 px-6 pb-16 pt-8">
      <div className="border-b border-border pb-6">
        <h1 className="font-cinzel text-3xl font-bold uppercase tracking-wider text-gold">Reportes</h1>
        <p className="mt-2 font-montserrat text-xs text-text-muted">
          Cómo va la captación, la atención y el seguimiento. Elige un período (máximo 366 días); el responsable es el último titular de cada caso.
        </p>
      </div>

      <form method="get" aria-label="Filtros del reporte" className="grid items-end gap-4 border border-border bg-card-bg p-5 sm:grid-cols-2 xl:grid-cols-6">
        <div>
          <label htmlFor="rep-desde" className={CLASE_ETIQUETA}>Desde</label>
          <input id="rep-desde" name="desde" type="date" required defaultValue={entrada.desde} className={CLASE_INPUT} />
        </div>
        <div>
          <label htmlFor="rep-hasta" className={CLASE_ETIQUETA}>Hasta</label>
          <input id="rep-hasta" name="hasta" type="date" required defaultValue={entrada.hasta} className={CLASE_INPUT} />
        </div>
        <div>
          <label htmlFor="rep-area" className={CLASE_ETIQUETA}>Área</label>
          <select id="rep-area" name="area" defaultValue={entrada.area ?? ''} className={CLASE_INPUT}>
            <option value="">Todas</option>
            {catalogo.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rep-canal" className={CLASE_ETIQUETA}>Canal</label>
          <select id="rep-canal" name="canal" defaultValue={entrada.canal ?? ''} className={CLASE_INPUT}>
            <option value="">Todos</option>
            {CANALES.map((c) => <option key={c} value={c}>{CANAL[c] ?? c}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rep-responsable" className={CLASE_ETIQUETA}>Responsable</label>
          <select id="rep-responsable" name="responsable" defaultValue={entrada.responsable ?? ''} className={CLASE_INPUT}>
            <option value="">Todos</option>
            {abogados.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </div>
        <div className="flex gap-3">
          <button type="submit" className={BOTON_PRIMARIO}>Ver reporte</button>
        </div>
      </form>

      {aviso && <Franja tipo={aviso.tipo}>{aviso.texto}</Franja>}

      {reporte && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-montserrat text-xs text-text-muted" aria-live="polite">
              Período: {reporte.periodo.desde} a {reporte.periodo.hasta}. Hora de Guayaquil.
            </p>
            <ExportarCsv consulta={consulta.toString()} />
          </div>
          <Contenido r={reporte} />
          <p className="font-montserrat text-[11px] leading-relaxed text-text-muted">
            El CSV trae una fila por solicitud recibida en el período, con los mismos filtros, sin descripciones, notas ni datos de contacto. Cada exportación queda registrada en el Historial.
          </p>
        </>
      )}
    </div>
  )
}
