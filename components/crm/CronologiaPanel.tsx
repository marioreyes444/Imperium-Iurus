'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Franja from '@/components/crm/Franja'
import TareaAcciones from '@/components/crm/TareaAcciones'
import { formatoFechaHora } from '@/components/crm/formato'
import { BOTON_BARRA, BOTON_PRIMARIO, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

type Actividad = {
  id: string
  tipo: string
  canal: string | null
  descripcion: string
  resultado: string | null
  es_juridica: boolean
  vence_at: string | null
  estado_tarea: string | null
  es_plazo_juridico: boolean
  plazo_verificado_at: string | null
  responsable: string | null
  autor: string | null
  verificado_por: string | null
  created_at: string
  acciones: { completar: boolean; cancelar: boolean; verificar_plazo: boolean; reprogramar: boolean }
}

const TIPO: Record<string, string> = {
  llamada: 'Llamada', reunion: 'Reunión', mensaje: 'Mensaje', actuacion: 'Actuación', tarea: 'Tarea', nota: 'Nota',
  cambio_estado: 'Cambio de estado', asignacion: 'Asignación', cita: 'Cita', sistema: 'Sistema',
}
const CANAL: Record<string, string> = { telefono: 'Teléfono', whatsapp: 'WhatsApp', correo: 'Correo', presencial: 'Presencial', videollamada: 'Videollamada', otro: 'Otro' }
const ESTADO_TAREA: Record<string, string> = { pendiente: 'Pendiente', hecha: 'Hecha', cancelada: 'Cancelada' }

/**
 * Cronología del caso con carga progresiva. Lo que llega ya viene filtrado por el servidor (asistencia
 * nunca recibe actividades jurídicas; el externo solo lo suyo).
 */
export default function CronologiaPanel({ solicitudId, puedeRegistrar, permiteJuridico, soloNotas, puedeCrearTareas }: {
  solicitudId: string
  puedeRegistrar: boolean
  permiteJuridico: boolean
  /** Externo: solo notas. */
  soloNotas: boolean
  puedeCrearTareas: boolean
}) {
  const [items, setItems] = useState<Actividad[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const centinela = useRef<HTMLDivElement>(null)

  // Formulario de registro (dentro de la página).
  const [tipo, setTipo] = useState(soloNotas ? 'nota' : 'llamada')
  const [canal, setCanal] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [resultado, setResultado] = useState('')
  const [juridica, setJuridica] = useState(false)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [errorForm, setErrorForm] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async (desde: string | null, reiniciar: boolean) => {
    setCargando(true)
    setError(null)
    try {
      const p = new URLSearchParams({ solicitud_id: solicitudId, limite: '30' })
      if (desde) p.set('cursor', desde)
      const res = await fetch(`/api/admin/crm/actividades?${p}`, { cache: 'no-store' })
      const cuerpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo cargar la cronología.')
        return
      }
      setItems((prev) => (reiniciar ? cuerpo.items : [...prev, ...cuerpo.items]))
      setCursor(cuerpo.siguienteCursor)
      setTotal(cuerpo.total)
    } catch {
      setError('No se pudo conectar. Inténtalo de nuevo.')
    } finally {
      setCargando(false)
    }
  }, [solicitudId])

  useEffect(() => { void cargar(null, true) }, [cargar, version])

  // Carga progresiva: al acercarse al final se trae el siguiente lote.
  useEffect(() => {
    const el = centinela.current
    if (!el || !cursor) return
    const obs = new IntersectionObserver((e) => { if (e[0]?.isIntersecting && !cargando) void cargar(cursor, false) }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [cursor, cargando, cargar])

  async function registrar() {
    setGuardando(true)
    setErrorForm(null)
    setCampos({})
    try {
      const res = await fetch('/api/admin/crm/actividades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solicitud_id: solicitudId, tipo, canal: canal || undefined, descripcion, resultado, es_juridica: permiteJuridico && juridica }),
      })
      const cuerpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCampos(cuerpo.campos ?? {})
        setErrorForm(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo registrar.')
        return
      }
      setDescripcion('')
      setResultado('')
      setJuridica(false)
      setMensaje('Actividad registrada.')
      setVersion((v) => v + 1)
    } catch {
      setErrorForm('No se pudo conectar. Inténtalo de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const seleccionada = items.find((a) => a.id === sel && a.tipo === 'tarea') ?? null
  const tieneTareas = items.some((a) => a.tipo === 'tarea')

  return (
    <div className="space-y-6">
      {puedeRegistrar && (
        <form onSubmit={(e) => { e.preventDefault(); void registrar() }} className="space-y-4 border border-border bg-card-bg px-5 py-4">
          <p className="font-cinzel text-xs uppercase tracking-[0.2em] text-gold">Registrar actividad</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cr-tipo" className={CLASE_ETIQUETA}>Tipo</label>
              <select id="cr-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={CLASE_INPUT} disabled={soloNotas}>
                {(soloNotas ? ['nota'] : ['llamada', 'mensaje', 'reunion', 'actuacion', 'nota']).map((t) => <option key={t} value={t}>{TIPO[t]}</option>)}
              </select>
            </div>
            {!soloNotas && (
              <div>
                <label htmlFor="cr-canal" className={CLASE_ETIQUETA}>Canal (opcional)</label>
                <select id="cr-canal" value={canal} onChange={(e) => setCanal(e.target.value)} className={CLASE_INPUT}>
                  <option value="">—</option>
                  {Object.entries(CANAL).map(([v, e]) => <option key={v} value={v}>{e}</option>)}
                </select>
              </div>
            )}
          </div>
          <div>
            <label htmlFor="cr-desc" className={CLASE_ETIQUETA}>Descripción</label>
            <textarea id="cr-desc" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} maxLength={5000} required className={CLASE_INPUT}
              aria-invalid={campos.descripcion ? true : undefined} aria-describedby={campos.descripcion ? 'cr-desc-error' : undefined} />
            {campos.descripcion && <p id="cr-desc-error" className="mt-1 font-montserrat text-xs text-red-400">{campos.descripcion}</p>}
          </div>
          {!soloNotas && (
            <div>
              <label htmlFor="cr-res" className={CLASE_ETIQUETA}>Resultado (opcional)</label>
              <input id="cr-res" value={resultado} onChange={(e) => setResultado(e.target.value)} maxLength={2000} className={CLASE_INPUT} />
            </div>
          )}
          {permiteJuridico && (
            <label className="flex items-center gap-2 font-montserrat text-sm text-text-light">
              <input type="checkbox" checked={juridica} onChange={(e) => setJuridica(e.target.checked)} className="accent-gold" />
              Nota jurídica (no visible para asistencia)
            </label>
          )}
          {errorForm && <Franja tipo="error">{errorForm}</Franja>}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={guardando} className={BOTON_PRIMARIO}>{guardando ? 'Guardando…' : 'Registrar'}</button>
            {puedeCrearTareas && <Link href={`/admin/crm/tareas/nueva?solicitud=${solicitudId}`} className={BOTON_BARRA}>+ Nueva tarea</Link>}
          </div>
        </form>
      )}

      {mensaje && <Franja tipo="exito">{mensaje}</Franja>}

      {tieneTareas && (
        <div className="space-y-2">
          <p aria-live="polite" className="font-montserrat text-xs text-text-muted">
            {seleccionada ? `Tarea seleccionada: ${seleccionada.descripcion}` : 'Ninguna tarea seleccionada (haz clic en una tarea para ver sus acciones)'}
          </p>
          <TareaAcciones tarea={seleccionada} onHecho={(m) => { setMensaje(m); setSel(null); setVersion((v) => v + 1) }} />
        </div>
      )}

      {error && <Franja tipo="error">{error}</Franja>}
      {!cargando && items.length === 0 && !error && (
        <p className="font-montserrat text-xs text-text-muted">Aún no hay actividades. Registra la primera llamada, mensaje o nota del caso.</p>
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-border border border-border bg-card-bg">
          {items.map((a) => {
            const esTarea = a.tipo === 'tarea'
            const activa = sel === a.id
            return (
              <li
                key={a.id}
                {...(esTarea ? {
                  tabIndex: 0,
                  'aria-current': activa ? ('true' as const) : undefined,
                  onClick: () => setSel(activa ? null : a.id),
                  onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(activa ? null : a.id) } },
                } : {})}
                className={`px-5 py-3 font-montserrat text-xs ${esTarea ? 'focus-gold cursor-pointer outline-none' : ''} ${activa ? 'bg-gold/10' : esTarea ? 'hover:bg-white/5' : ''}`}
              >
                <p className="text-text-light">
                  <span className="text-gold">{TIPO[a.tipo] ?? a.tipo}</span>
                  {a.canal ? ` · ${CANAL[a.canal] ?? a.canal}` : ''}
                  {a.es_juridica ? ' · Jurídica' : ''}
                  {esTarea && a.estado_tarea ? ` · ${ESTADO_TAREA[a.estado_tarea] ?? a.estado_tarea}` : ''}
                  {a.es_plazo_juridico ? (a.plazo_verificado_at ? ' · Plazo verificado' : ' · Plazo por verificar') : ''}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-text-light/90">{a.descripcion}</p>
                {a.resultado && <p className="mt-1 text-text-muted">Resultado: {a.resultado}</p>}
                <p className="mt-1 text-text-muted">
                  {formatoFechaHora(a.created_at)} · {a.autor ?? 'Automático'}
                  {esTarea && a.responsable ? ` · Responsable: ${a.responsable}` : ''}
                  {esTarea && a.vence_at ? ` · Vence: ${formatoFechaHora(a.vence_at)}` : ''}
                  {a.verificado_por ? ` · Verificó: ${a.verificado_por}` : ''}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      <div ref={centinela} />
      <p className="font-montserrat text-[11px] text-text-muted" aria-live="polite">
        {cargando ? 'Cargando…' : total > 0 ? `Mostrando ${items.length} de ${total} actividades` : ''}
      </p>
    </div>
  )
}
