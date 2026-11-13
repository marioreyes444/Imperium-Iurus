import Link from 'next/link'
import Franja from '@/components/crm/Franja'
import BarraProporcion from '@/components/crm/BarraProporcion'
import Indicador from '@/components/crm/Indicador'
import { formatoFechaHora } from '@/components/crm/formato'
import { CrmNoDisponibleError, getSesionCrm, nivelTablero } from '@/lib/crm/permisos'
import { obtenerTablero, obtenerTableroCompleto, type Tablero, type TableroCompleto } from '@/lib/crm/tablero'
import { ETIQUETA_ESTADO, type Estado } from '@/lib/crm/estados'
import { TOPE_OBJETIVOS_TABLERO } from '@/lib/crm/config'

export const dynamic = 'force-dynamic'

const TARJETAS: { clave: keyof Tablero['contadores']; etiqueta: string }[] = [
  { clave: 'nuevas',            etiqueta: 'Solicitudes nuevas' },
  { clave: 'por_validar',       etiqueta: 'Por validar' },
  { clave: 'casos_activos',     etiqueta: 'Casos activos' },
  { clave: 'tareas_pendientes', etiqueta: 'Mis tareas pendientes' },
  { clave: 'tareas_vencidas',   etiqueta: 'Mis tareas vencidas' },
  { clave: 'avisos_sin_leer',   etiqueta: 'Avisos sin leer' },
]

const URGENCIA: Record<string, string> = { critica: 'Crítica', alta: 'Alta', media: 'Media', ordinaria: 'Ordinaria' }

const TITULO_SECCION = 'font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80'

function Pendientes({ tablero }: { tablero: Tablero }) {
  return (
    <section aria-labelledby="titulo-pendientes">
      <h2 id="titulo-pendientes" className={TITULO_SECCION}>Mis pendientes</h2>
      {tablero.pendientes.length === 0 ? (
        <p className="mt-4 font-montserrat text-xs leading-relaxed text-text-muted">
          No tienes tareas pendientes. Las tareas y los plazos que se te asignen aparecerán aquí.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border border border-border bg-card-bg">
          {tablero.pendientes.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-4 px-5 py-3">
              <p className="min-w-0 flex-1 truncate font-montserrat text-xs text-text-light" title={p.descripcion}>
                {p.es_plazo_juridico && (
                  <span className="mr-2 text-[10px] uppercase tracking-widest text-gold">
                    {p.plazo_verificado ? 'Plazo verificado' : 'Plazo'}
                  </span>
                )}
                {p.descripcion}
              </p>
              <p className="shrink-0 font-montserrat text-[11px] text-text-muted">{formatoFechaHora(p.vence_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Contadores({ tablero }: { tablero: Tablero }) {
  return (
    <section aria-label="Contadores" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {TARJETAS.filter((t) => tablero.contadores[t.clave] !== null).map((t) => (
        <div key={t.clave} className="border border-border bg-card-bg px-5 py-4">
          <p className="font-cinzel text-3xl font-bold tabular-nums text-gold">{tablero.contadores[t.clave]}</p>
          <p className="mt-1 font-montserrat text-[10px] uppercase tracking-widest text-text-muted">{t.etiqueta}</p>
        </div>
      ))}
    </section>
  )
}

function Completo({ t }: { t: TableroCompleto }) {
  const propio = t.nivel === 'propio'
  const o = t.objetivos
  return (
    <>
      <Contadores tablero={t.basico} />

      <section aria-labelledby="titulo-estados">
        <h2 id="titulo-estados" className={TITULO_SECCION}>{propio ? 'Mis casos por estado' : 'Casos por estado'}</h2>
        <ul className="mt-4 grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
          {t.casos_por_estado.map((c) => (
            <li key={c.estado} className="bg-card-bg px-5 py-3">
              <Link href={`/admin/crm/solicitudes?estado=${c.estado}`} className="focus-gold flex items-baseline justify-between gap-3 font-montserrat text-xs text-text-light hover:text-gold">
                <span>{ETIQUETA_ESTADO[c.estado as Estado] ?? c.estado}</span>
                <span className="font-cinzel text-lg font-bold tabular-nums text-gold">{c.total}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="titulo-vencimientos">
        <h2 id="titulo-vencimientos" className={TITULO_SECCION}>Vencimientos</h2>
        <p className="mt-3 font-montserrat text-xs text-text-muted">
          Tareas y plazos pendientes{propio ? ' de tus casos' : ''}:{' '}
          <span className={t.vencimientos.vencidas > 0 ? 'font-semibold text-red-400' : 'text-text-light'}>{t.vencimientos.vencidas} vencidos</span>
          {' · '}
          <span className="text-text-light">{t.vencimientos.proximas_7_dias} por vencer en 7 días</span>
        </p>
        {t.vencimientos.lista.length === 0 ? (
          <p className="mt-3 font-montserrat text-xs leading-relaxed text-text-muted">No hay tareas ni plazos pendientes.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border border border-border bg-card-bg">
            {t.vencimientos.lista.map((v) => {
              const vencida = !!v.vence_at && Date.parse(v.vence_at) < Date.now()
              return (
                <li key={v.id} className="flex items-start justify-between gap-4 px-5 py-3">
                  <p className="min-w-0 flex-1 truncate font-montserrat text-xs text-text-light" title={v.descripcion}>
                    {v.es_plazo_juridico && (
                      <span className="mr-2 text-[10px] uppercase tracking-widest text-gold">{v.plazo_verificado ? 'Plazo verificado' : 'Plazo'}</span>
                    )}
                    {v.codigo && v.solicitud_id && (
                      <Link href={`/admin/crm/solicitudes/${v.solicitud_id}?tab=cronologia`} className="focus-gold mr-2 text-text-muted hover:text-gold">{v.codigo}</Link>
                    )}
                    {v.descripcion}
                    {v.responsable && <span className="ml-2 text-text-muted">· {v.responsable}</span>}
                  </p>
                  <p className="shrink-0 font-montserrat text-[11px]">
                    <Indicador texto={v.vence_at ? formatoFechaHora(v.vence_at) : '—'} forma="cuadrado" relleno={vencida ? 'rojo' : 'ninguno'} resaltado={vencida} />
                  </p>
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-2 font-montserrat text-[11px] text-text-muted">
          Los plazos jurídicos verificados van primero. <Link href="/admin/crm/tareas?estado=pendiente" className="focus-gold text-gold hover:underline">Ver todas las tareas</Link>
        </p>
      </section>

      <section aria-labelledby="titulo-objetivos">
        <h2 id="titulo-objetivos" className={TITULO_SECCION}>Objetivos de primer contacto</h2>
        <p className="mt-3 font-montserrat text-xs text-text-muted" aria-live="polite">
          Solicitudes sin primera respuesta:{' '}
          <span className="text-text-light">{o.tope ? `${TOPE_OBJETIVOS_TABLERO} o más` : o.evaluadas}</span>
          {' · '}
          <span className={o.incumplidos > 0 ? 'font-semibold text-red-400' : 'text-text-light'}>
            {o.incumplidos} {o.incumplidos === 1 ? 'incumplida' : 'incumplidas'}{o.tope ? ` (de las ${TOPE_OBJETIVOS_TABLERO} más antiguas)` : ''}
          </span>
          {' · '}
          <span className="text-text-light">{o.en_curso} en curso</span>
        </p>
        {o.lista.length === 0 ? (
          <p className="mt-3 font-montserrat text-xs leading-relaxed text-text-muted">No hay objetivos incumplidos.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border border border-border bg-card-bg">
            {o.lista.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <Link href={`/admin/crm/solicitudes/${f.id}`} className="focus-gold font-montserrat text-xs text-text-light hover:text-gold">{f.codigo}</Link>
                <Indicador texto={URGENCIA[f.urgencia] ?? f.urgencia} forma="cuadrado"
                  relleno={f.urgencia === 'critica' ? 'rojo' : f.urgencia === 'alta' ? 'dorado' : f.urgencia === 'media' ? 'contorno' : 'ninguno'}
                  resaltado={f.urgencia === 'critica'} atenuado={f.urgencia === 'ordinaria'} />
                <p className="font-montserrat text-[11px] text-text-muted">Debió responderse antes de {formatoFechaHora(f.vence_at)}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 font-montserrat text-[11px] text-text-muted">
          Horas hábiles supuestas: lunes a viernes, 09:00–18:00, sin feriados. La crítica se mide en 60 minutos corridos.
        </p>
      </section>

      <section aria-labelledby="titulo-carga">
        <h2 id="titulo-carga" className={TITULO_SECCION}>{propio ? 'Mi carga' : 'Carga por persona'}</h2>
        {t.carga.length === 0 ? (
          <p className="mt-3 font-montserrat text-xs leading-relaxed text-text-muted">Todavía no hay casos asignados como titular.</p>
        ) : (
          <div className="mt-4 overflow-x-auto border border-border bg-card-bg">
            <table className="w-full min-w-[640px] table-fixed border-collapse">
              <caption className="sr-only">Casos como titular frente a la capacidad máxima de cada persona</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="w-[28%] px-4 py-2.5 text-left font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-muted">Persona</th>
                  <th scope="col" className="w-[34%] px-4 py-2.5 text-left font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-muted">Casos como titular</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-muted">Apoyo</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-muted">Tareas vencidas</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-muted">Vencen en 7 días</th>
                </tr>
              </thead>
              <tbody>
                {t.carga.map((c) => {
                  const alLimite = c.capacidad_maxima !== null && c.carga_titular >= c.capacidad_maxima
                  return (
                    <tr key={c.personal_id} className="border-b border-border/60">
                      <td className="truncate px-4 py-3 font-montserrat text-xs text-text-light" title={c.nombre}>{c.nombre}</td>
                      <td className="px-4 py-3 font-montserrat text-xs text-text-light">
                        <span className="tabular-nums">
                          {c.carga_titular} {c.capacidad_maxima !== null ? `de ${c.capacidad_maxima}` : '(sin límite definido)'}
                        </span>
                        {alLimite && <span className="ml-2 font-semibold text-red-400">· en su límite</span>}
                        {c.capacidad_maxima !== null && (
                          <div className="mt-1.5"><BarraProporcion valor={c.carga_titular} total={c.capacidad_maxima} etiqueta={`Carga de ${c.nombre}`} alLimite={alLimite} /></div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-montserrat text-xs tabular-nums text-text-light">{c.casos_apoyo}</td>
                      <td className={`px-4 py-3 font-montserrat text-xs tabular-nums ${c.tareas_vencidas > 0 ? 'font-semibold text-red-400' : 'text-text-light'}`}>{c.tareas_vencidas}</td>
                      <td className="px-4 py-3 font-montserrat text-xs tabular-nums text-text-light">{c.tareas_7_dias}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Pendientes tablero={t.basico} />
    </>
  )
}

export default async function TableroPage() {
  const sesion = await getSesionCrm()
  // El armazón (layout) explica por qué no hay acceso; aquí no se muestra nada.
  if (sesion.estado !== 'ok') return null

  const nivel = nivelTablero(sesion.personal.rol)
  let basico: Tablero | null = null
  let completo: TableroCompleto | null = null
  let noDisponible = false
  try {
    if (nivel === 'basico') basico = await obtenerTablero(sesion.personal)
    else completo = await obtenerTableroCompleto(sesion.personal, nivel)
  } catch (e) {
    if (e instanceof CrmNoDisponibleError) noDisponible = true
    else console.error('[admin/crm] tablero', e instanceof Error ? e.message : 'error')
  }

  return (
    <div className="space-y-8 px-6 pb-16 pt-8">
      <div className="border-b border-border pb-6">
        <h1 className="font-cinzel text-3xl font-bold uppercase tracking-wider text-gold">Tablero</h1>
        <p className="mt-2 font-montserrat text-xs text-text-muted">
          Hola, {sesion.personal.nombres}. {nivel === 'completo' ? 'Esto es lo que necesita atención hoy.' : 'Esto es lo tuyo hoy.'}
        </p>
      </div>

      {noDisponible && (
        <Franja tipo="info">
          Los datos del CRM aún no están disponibles en este entorno (faltan las migraciones de la base).
        </Franja>
      )}
      {!noDisponible && !basico && !completo && (
        <Franja tipo="error">No se pudo cargar el tablero. Inténtalo de nuevo.</Franja>
      )}

      {basico && (
        <>
          <Contadores tablero={basico} />
          <Pendientes tablero={basico} />
        </>
      )}
      {completo && <Completo t={completo} />}
    </div>
  )
}
