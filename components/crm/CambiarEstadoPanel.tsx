'use client'

import { useEffect, useState } from 'react'
import PanelAccion from '@/components/crm/PanelAccion'
import { CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

type OpcionEstado = { valor: string; etiqueta: string; exige_motivo: boolean; pide_cierre: boolean }

type Props = {
  solicitudId: string
  /** Si no se indican, se piden al servidor: solo los estados permitidos desde el actual y para el rol. */
  estados?: OpcionEstado[]
  onHecho: (mensaje: string) => void
  onCancelar: () => void
}

const OPCIONES_DELICADAS = new Set(['descartada', 'cerrada'])

/** «Cambiar estado»: ofrece SOLO los estados permitidos y pide motivo cuando la regla lo exige. */
export default function CambiarEstadoPanel({ solicitudId, estados, onHecho, onCancelar }: Props) {
  const [opciones, setOpciones] = useState<OpcionEstado[] | null>(estados ?? null)
  const [hacia, setHacia] = useState('')
  const [motivo, setMotivo] = useState('')
  const [resultado, setResultado] = useState('')
  const [pendientes, setPendientes] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})

  useEffect(() => {
    if (estados) return
    let vigente = true
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/crm/solicitudes/${solicitudId}`, { cache: 'no-store' })
        const cuerpo = await res.json().catch(() => ({}))
        if (!vigente) return
        if (!res.ok) { setError(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudieron cargar los estados.'); setOpciones([]); return }
        setOpciones(cuerpo.estados_permitidos as OpcionEstado[])
      } catch {
        if (vigente) { setError('No se pudo conectar con el servidor.'); setOpciones([]) }
      }
    })()
    return () => { vigente = false }
  }, [estados, solicitudId])

  const elegida = opciones?.find((o) => o.valor === hacia)

  async function guardar() {
    if (!elegida) { setError('Elige el nuevo estado.'); return }
    setGuardando(true); setError(null); setCampos({})
    try {
      const res = await fetch(`/api/admin/crm/solicitudes/${solicitudId}/estado`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hacia,
          motivo: motivo.trim() || undefined,
          resultado_cierre: elegida.pide_cierre ? resultado : undefined,
          pendientes_cierre: elegida.pide_cierre && pendientes.trim() ? pendientes : undefined,
        }),
      })
      const cuerpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (cuerpo.campos) setCampos(cuerpo.campos as Record<string, string>)
        if (!cuerpo.campos || cuerpo.codigo) setError(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo cambiar el estado.')
        return
      }
      onHecho(`Estado cambiado a «${elegida.etiqueta}».`)
    } catch {
      setError('No se pudo conectar con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  const campoError = (c: string) => (campos[c] ? <p id={`est-${c}-error`} className="mt-1 font-montserrat text-xs text-red-400">{campos[c]}</p> : null)

  return (
    <PanelAccion
      titulo="Cambiar estado"
      delicada={OPCIONES_DELICADAS.has(hacia)}
      etiquetaGuardar="Cambiar estado"
      guardando={guardando}
      error={error}
      onGuardar={guardar}
      onCancelar={onCancelar}
      resumen={elegida && OPCIONES_DELICADAS.has(hacia)
        ? (hacia === 'descartada'
          ? 'Las tareas pendientes del caso se cancelarán. Para volver a trabajarlo, Dirección tendrá que reabrirlo.'
          : 'El caso queda en solo lectura. Para volver a trabajarlo, Dirección tendrá que reabrirlo.')
        : undefined}
    >
      {opciones === null && <p className="font-montserrat text-xs text-text-muted">Cargando…</p>}
      {opciones && opciones.length === 0 && !error && (
        <p className="font-montserrat text-xs text-text-muted">No hay cambios de estado disponibles para ti desde el estado actual.</p>
      )}
      {opciones && opciones.length > 0 && (
        <>
          <div>
            <label htmlFor="est-hacia" className={CLASE_ETIQUETA}>Nuevo estado</label>
            <select id="est-hacia" value={hacia} onChange={(e) => setHacia(e.target.value)} className={CLASE_INPUT}>
              <option value="">Elige un estado</option>
              {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
            </select>
          </div>
          {elegida?.exige_motivo && (
            <div>
              <label htmlFor="est-motivo" className={CLASE_ETIQUETA}>Motivo (obligatorio)</label>
              <textarea id="est-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} className={CLASE_INPUT}
                aria-invalid={campos.motivo ? true : undefined} aria-describedby={campos.motivo ? 'est-motivo-error' : undefined} />
              {campoError('motivo')}
            </div>
          )}
          {elegida?.pide_cierre && (
            <>
              <div>
                <label htmlFor="est-resultado" className={CLASE_ETIQUETA}>Resultado del cierre (obligatorio)</label>
                <textarea id="est-resultado" value={resultado} onChange={(e) => setResultado(e.target.value)} rows={2} maxLength={2000} className={CLASE_INPUT}
                  aria-invalid={campos.resultado_cierre ? true : undefined} aria-describedby={campos.resultado_cierre ? 'est-resultado_cierre-error' : undefined} />
                {campoError('resultado_cierre')}
              </div>
              <div>
                <label htmlFor="est-pendientes" className={CLASE_ETIQUETA}>Tareas pendientes de cumplimiento (si hay tareas abiertas)</label>
                <textarea id="est-pendientes" value={pendientes} onChange={(e) => setPendientes(e.target.value)} rows={2} maxLength={2000} className={CLASE_INPUT}
                  aria-invalid={campos.pendientes_cierre ? true : undefined} aria-describedby={campos.pendientes_cierre ? 'est-pendientes_cierre-error' : undefined} />
                {campoError('pendientes_cierre')}
              </div>
            </>
          )}
        </>
      )}
    </PanelAccion>
  )
}
