import Franja from '@/components/crm/Franja'
import { formatoFechaHora } from '@/components/crm/formato'
import { CrmNoDisponibleError, getSesionCrm } from '@/lib/crm/permisos'
import { obtenerTablero, type Tablero } from '@/lib/crm/tablero'

export const dynamic = 'force-dynamic'

const TARJETAS: { clave: keyof Tablero['contadores']; etiqueta: string }[] = [
  { clave: 'nuevas',            etiqueta: 'Solicitudes nuevas' },
  { clave: 'por_validar',       etiqueta: 'Por validar' },
  { clave: 'casos_activos',     etiqueta: 'Casos activos' },
  { clave: 'tareas_pendientes', etiqueta: 'Mis tareas pendientes' },
  { clave: 'tareas_vencidas',   etiqueta: 'Mis tareas vencidas' },
  { clave: 'avisos_sin_leer',   etiqueta: 'Avisos sin leer' },
]

export default async function TableroPage() {
  const sesion = await getSesionCrm()
  // El armazón (layout) explica por qué no hay acceso; aquí no se muestra nada.
  if (sesion.estado !== 'ok') return null

  let tablero: Tablero | null = null
  let noDisponible = false
  try {
    tablero = await obtenerTablero(sesion.personal)
  } catch (e) {
    if (e instanceof CrmNoDisponibleError) noDisponible = true
    else console.error('[admin/crm] tablero', e instanceof Error ? e.message : 'error')
  }

  return (
    <div className="space-y-8 px-6 pb-16 pt-8">
      <div className="border-b border-border pb-6">
        <h1 className="font-cinzel text-3xl font-bold uppercase tracking-wider text-gold">Tablero</h1>
        <p className="mt-2 font-montserrat text-xs text-text-muted">
          Hola, {sesion.personal.nombres}. Esto es lo tuyo hoy.
        </p>
      </div>

      {noDisponible && (
        <Franja tipo="info">
          Los datos del CRM aún no están disponibles en este entorno (faltan las migraciones de la base).
        </Franja>
      )}
      {!noDisponible && !tablero && (
        <Franja tipo="error">No se pudo cargar el tablero. Inténtalo de nuevo.</Franja>
      )}

      {tablero && (
        <>
          <section aria-label="Contadores" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {TARJETAS.filter((t) => tablero.contadores[t.clave] !== null).map((t) => (
              <div key={t.clave} className="border border-border bg-card-bg px-5 py-4">
                <p className="font-cinzel text-3xl font-bold tabular-nums text-gold">{tablero.contadores[t.clave]}</p>
                <p className="mt-1 font-montserrat text-[10px] uppercase tracking-widest text-text-muted">{t.etiqueta}</p>
              </div>
            ))}
          </section>

          <section aria-labelledby="titulo-pendientes">
            <h2 id="titulo-pendientes" className="font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80">
              Mis pendientes
            </h2>
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
        </>
      )}
    </div>
  )
}
