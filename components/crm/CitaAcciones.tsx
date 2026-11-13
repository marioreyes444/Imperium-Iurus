'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PanelAccion from '@/components/crm/PanelAccion'
import Franja from '@/components/crm/Franja'
import { BOTON_BARRA, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

export type CitaAccionable = {
  id: string
  fecha: string
  hora: string
  estado: string
  ya_paso: boolean
  solicitud_id: string | null
  codigo: string | null
  abogado: string | null
  /** El servidor ya decidió si esta persona puede gestionar la cita. */
  gestionable: boolean
}

type Panel = 'cancelar' | 'marcar' | null

const ORIGENES = [
  { valor: 'cliente', etiqueta: 'El cliente' },
  { valor: 'estudio', etiqueta: 'El estudio' },
  { valor: 'abogado', etiqueta: 'El abogado' },
]

const fecha = (f: string, h: string) => {
  const [y, m, d] = f.split('-')
  return `${d}/${m}/${y} ${h.slice(0, 5)}`
}

/**
 * Acciones de una cita: reagendar (página propia), confirmar, marcar atendida / no asistió (R-39: solo si
 * ya pasó) y cancelar con motivo (R-37). Una cita cancelada o concluida no ofrece reactivarla (R-38).
 */
export default function CitaAcciones({ cita, onCambio }: { cita: CitaAccionable | null; onCambio?: () => void }) {
  const router = useRouter()
  const [panel, setPanel] = useState<Panel>(null)
  const [origen, setOrigen] = useState('')
  const [motivo, setMotivo] = useState('')
  const [resultado, setResultado] = useState<'atendida' | 'no_asistio'>('atendida')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [exito, setExito] = useState<string | null>(null)
  const [citaPanel, setCitaPanel] = useState<string | null>(null)

  // Al cambiar de cita se cierra el panel abierto.
  if ((cita?.id ?? null) !== citaPanel) {
    setCitaPanel(cita?.id ?? null)
    setPanel(null)
    setError(null)
    setCampos({})
  }

  const activa = !!cita && (cita.estado === 'pendiente' || cita.estado === 'confirmada')
  const puede = !!cita && cita.gestionable && activa

  async function enviar(url: string, metodo: 'POST' | 'PATCH', cuerpo: unknown, mensajeExito: string) {
    setGuardando(true)
    setError(null)
    setCampos({})
    try {
      const res = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
      const datos = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCampos(datos.campos ?? {})
        setError(typeof datos.error === 'string' ? datos.error : 'No se pudo completar la acción.')
        return
      }
      setPanel(null)
      setMotivo('')
      setOrigen('')
      setExito(mensajeExito)
      onCambio?.()
      router.refresh()
    } catch {
      setError('No se pudo conectar. Inténtalo de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {cita?.solicitud_id && (
          <Link href={`/admin/crm/solicitudes/${cita.solicitud_id}?tab=citas`} className={BOTON_BARRA}>Ver caso</Link>
        )}
        <button type="button" disabled={!puede} onClick={() => cita && router.push(`/admin/crm/citas/${cita.id}/reagendar`)} className={BOTON_BARRA}>
          {cita && !cita.abogado ? 'Asignar abogado' : 'Reagendar'}
        </button>
        <button type="button" disabled={!puede || cita?.estado !== 'pendiente' || guardando}
          onClick={() => cita && enviar(`/api/admin/crm/citas/${cita.id}`, 'PATCH', { accion: 'confirmar' }, 'Cita confirmada.')}
          className={BOTON_BARRA}>
          Confirmar
        </button>
        <button type="button" disabled={!puede || !cita?.ya_paso} onClick={() => setPanel('marcar')} className={BOTON_BARRA}
          title={cita && activa && !cita.ya_paso ? 'Disponible cuando haya pasado la hora de la cita' : undefined}>
          Marcar resultado
        </button>
        <button type="button" disabled={!puede} onClick={() => setPanel('cancelar')} className={BOTON_BARRA}>Cancelar cita</button>
      </div>

      {exito && !panel && <Franja tipo="exito">{exito}</Franja>}

      {cita && panel === 'cancelar' && (
        <PanelAccion
          titulo="Cancelar cita"
          delicada
          resumen={<>Se cancelará la cita del {fecha(cita.fecha, cita.hora)}{cita.codigo ? ` (${cita.codigo})` : ''}. La hora quedará libre, el caso volverá a calificación si estaba en «consulta agendada» y se creará la tarea de reagendar. Una cita cancelada no se puede reactivar.</>}
          etiquetaGuardar="Cancelar cita"
          guardando={guardando}
          error={error}
          onCancelar={() => setPanel(null)}
          onGuardar={() => enviar(`/api/admin/crm/citas/${cita.id}/cancelar`, 'POST', { origen: origen || undefined, motivo }, 'Cita cancelada.')}
        >
          <div>
            <label htmlFor="cc-origen" className={CLASE_ETIQUETA}>Quién cancela</label>
            <select id="cc-origen" value={origen} onChange={(e) => setOrigen(e.target.value)} className={CLASE_INPUT}
              aria-invalid={campos.origen ? true : undefined} aria-describedby={campos.origen ? 'cc-origen-error' : undefined}>
              <option value="">Elige…</option>
              {ORIGENES.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
            </select>
            {campos.origen && <p id="cc-origen-error" className="mt-1 font-montserrat text-xs text-red-400">{campos.origen}</p>}
          </div>
          <div>
            <label htmlFor="cc-motivo" className={CLASE_ETIQUETA}>Motivo (mínimo 5 caracteres)</label>
            <textarea id="cc-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} className={CLASE_INPUT}
              aria-invalid={campos.motivo ? true : undefined} aria-describedby={campos.motivo ? 'cc-motivo-error' : undefined} />
            {campos.motivo && <p id="cc-motivo-error" className="mt-1 font-montserrat text-xs text-red-400">{campos.motivo}</p>}
          </div>
        </PanelAccion>
      )}

      {cita && panel === 'marcar' && (
        <PanelAccion
          titulo="Resultado de la cita"
          resumen={<>Cita del {fecha(cita.fecha, cita.hora)}. Una vez marcada, no vuelve a estar activa.</>}
          guardando={guardando}
          error={error}
          onCancelar={() => setPanel(null)}
          onGuardar={() => enviar(`/api/admin/crm/citas/${cita.id}`, 'PATCH', { accion: 'marcar', resultado }, resultado === 'atendida' ? 'Cita marcada como atendida.' : 'Cita marcada como no asistida.')}
        >
          <fieldset className="flex flex-wrap gap-6">
            <legend className={CLASE_ETIQUETA}>Resultado</legend>
            {([['atendida', 'Atendida'], ['no_asistio', 'No asistió']] as const).map(([v, e]) => (
              <label key={v} className="flex items-center gap-2 font-montserrat text-sm text-text-light">
                <input type="radio" name="cm-resultado" value={v} checked={resultado === v} onChange={() => setResultado(v)} className="accent-gold" />
                {e}
              </label>
            ))}
          </fieldset>
        </PanelAccion>
      )}
    </div>
  )
}
