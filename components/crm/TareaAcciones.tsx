'use client'

import { useState } from 'react'
import PanelAccion from '@/components/crm/PanelAccion'
import { BOTON_BARRA, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

export type TareaAccionable = {
  id: string
  descripcion: string
  es_plazo_juridico: boolean
  /** Lo decide el servidor (lib/crm/permisos.ts). */
  acciones: { completar: boolean; cancelar: boolean; verificar_plazo: boolean; reprogramar: boolean }
}

type Panel = 'completar' | 'cancelar' | 'verificar' | 'reprogramar' | null

/** Acciones cortas sobre una tarea, en un panel dentro de la página. Solo se muestran las permitidas. */
export default function TareaAcciones({ tarea, onHecho }: { tarea: TareaAccionable | null; onHecho: (mensaje: string) => void }) {
  const [panel, setPanel] = useState<Panel>(null)
  const [resultado, setResultado] = useState('')
  const [vence, setVence] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [tareaPanel, setTareaPanel] = useState<string | null>(null)

  if ((tarea?.id ?? null) !== tareaPanel) {
    setTareaPanel(tarea?.id ?? null)
    setPanel(null)
    setError(null)
    setCampos({})
  }

  async function enviar(cuerpo: Record<string, unknown>, mensaje: string) {
    if (!tarea) return
    setGuardando(true)
    setError(null)
    setCampos({})
    try {
      const res = await fetch(`/api/admin/crm/actividades/${tarea.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
      })
      const datos = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCampos(datos.campos ?? {})
        setError(typeof datos.error === 'string' ? datos.error : 'No se pudo completar la acción.')
        return
      }
      setPanel(null)
      setResultado('')
      setVence('')
      onHecho(mensaje)
    } catch {
      setError('No se pudo conectar. Inténtalo de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const a = tarea?.acciones
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!a?.completar} onClick={() => setPanel('completar')} className={BOTON_BARRA}>Completar</button>
        {(!tarea || tarea.es_plazo_juridico) && (
          <button type="button" disabled={!a?.verificar_plazo} onClick={() => setPanel('verificar')} className={BOTON_BARRA}>Verificar plazo</button>
        )}
        <button type="button" disabled={!a?.reprogramar} onClick={() => setPanel('reprogramar')} className={BOTON_BARRA}>Cambiar vencimiento</button>
        <button type="button" disabled={!a?.cancelar} onClick={() => setPanel('cancelar')} className={BOTON_BARRA}>Cancelar tarea</button>
      </div>

      {tarea && panel === 'completar' && (
        <PanelAccion titulo="Completar tarea" resumen={tarea.descripcion} guardando={guardando} error={error}
          onCancelar={() => setPanel(null)} onGuardar={() => enviar({ accion: 'completar', resultado }, 'Tarea completada.')}>
          <div>
            <label htmlFor="ta-resultado" className={CLASE_ETIQUETA}>Resultado (opcional)</label>
            <textarea id="ta-resultado" value={resultado} onChange={(e) => setResultado(e.target.value)} rows={2} maxLength={2000} className={CLASE_INPUT} />
          </div>
        </PanelAccion>
      )}
      {tarea && panel === 'verificar' && (
        <PanelAccion titulo="Verificar plazo jurídico" resumen={<>Confirmas que el plazo «{tarea.descripcion}» y su vencimiento están verificados. Desde ahora irá primero en las bandejas.</>}
          etiquetaGuardar="Verificar" guardando={guardando} error={error}
          onCancelar={() => setPanel(null)} onGuardar={() => enviar({ accion: 'verificar_plazo' }, 'Plazo verificado.')} />
      )}
      {tarea && panel === 'reprogramar' && (
        <PanelAccion titulo="Cambiar vencimiento" resumen={tarea.descripcion} guardando={guardando} error={error}
          onCancelar={() => setPanel(null)} onGuardar={() => enviar({ accion: 'reprogramar', vence_at: vence }, 'Vencimiento actualizado.')}>
          <div>
            <label htmlFor="ta-vence" className={CLASE_ETIQUETA}>Nuevo vencimiento</label>
            <input id="ta-vence" type="datetime-local" value={vence} onChange={(e) => setVence(e.target.value)} className={CLASE_INPUT}
              aria-invalid={campos.vence_at ? true : undefined} aria-describedby={campos.vence_at ? 'ta-vence-error' : undefined} />
            {campos.vence_at && <p id="ta-vence-error" className="mt-1 font-montserrat text-xs text-red-400">{campos.vence_at}</p>}
          </div>
        </PanelAccion>
      )}
      {tarea && panel === 'cancelar' && (
        <PanelAccion titulo="Cancelar tarea" delicada resumen={<>La tarea «{tarea.descripcion}» quedará cancelada.</>}
          etiquetaGuardar="Cancelar tarea" guardando={guardando} error={error}
          onCancelar={() => setPanel(null)} onGuardar={() => enviar({ accion: 'cancelar' }, 'Tarea cancelada.')} />
      )}
    </div>
  )
}
