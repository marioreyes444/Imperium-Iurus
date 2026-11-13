'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Franja from '@/components/crm/Franja'
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

type Persona = { id: string; nombre: string }

/**
 * Nueva tarea de un caso (R-40: responsable, vencimiento y estado). Un plazo jurídico (R-41) es una tarea
 * jurídica: asistencia no lo crea ni lo recibe (el servidor lo comprueba; aquí solo no se ofrece).
 */
export default function TareaForm({ solicitudId, codigo, responsables, responsablesJuridicos, permiteJuridico, yo, volverHref }: {
  solicitudId: string
  codigo: string
  responsables: Persona[]
  responsablesJuridicos: Persona[]
  permiteJuridico: boolean
  yo: string
  volverHref: string
}) {
  const router = useRouter()
  const [descripcion, setDescripcion] = useState('')
  const [vence, setVence] = useState('')
  const [plazo, setPlazo] = useState(false)
  const [juridica, setJuridica] = useState(false)
  const lista = plazo || juridica ? responsablesJuridicos : responsables
  const [responsable, setResponsable] = useState(responsables.some((p) => p.id === yo) ? yo : (responsables[0]?.id ?? ''))
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    setGuardando(true)
    setError(null)
    setCampos({})
    try {
      const res = await fetch('/api/admin/crm/actividades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          solicitud_id: solicitudId, tipo: 'tarea', descripcion, responsable_id: responsable || undefined,
          vence_at: vence || undefined, es_plazo_juridico: plazo, es_juridica: juridica || plazo,
        }),
      })
      const cuerpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCampos(cuerpo.campos ?? {})
        setError(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo crear la tarea.')
        return
      }
      router.push(`${volverHref}${volverHref.includes('?') ? '&' : '?'}aviso=tarea_creada`)
      router.refresh()
    } catch {
      setError('No se pudo conectar. Inténtalo de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const err = (c: string) => campos[c] && <p id={`tf-${c}-error`} className="mt-1 font-montserrat text-xs text-red-400">{campos[c]}</p>
  const inv = (c: string) => (campos[c] ? { 'aria-invalid': true as const, 'aria-describedby': `tf-${c}-error` } : {})

  return (
    <form onSubmit={(e) => { e.preventDefault(); void guardar() }} className="max-w-2xl space-y-5">
      <p className="font-montserrat text-xs text-text-muted">Caso {codigo}</p>
      <div>
        <label htmlFor="tf-descripcion" className={CLASE_ETIQUETA}>Tarea</label>
        <textarea id="tf-descripcion" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} maxLength={5000} required className={CLASE_INPUT} {...inv('descripcion')} />
        {err('descripcion')}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="tf-responsable" className={CLASE_ETIQUETA}>Responsable</label>
          <select id="tf-responsable" value={lista.some((p) => p.id === responsable) ? responsable : ''} onChange={(e) => setResponsable(e.target.value)} className={CLASE_INPUT} {...inv('responsable_id')}>
            <option value="">Elige…</option>
            {lista.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          {err('responsable_id')}
        </div>
        <div>
          <label htmlFor="tf-vence" className={CLASE_ETIQUETA}>Vence</label>
          <input id="tf-vence" type="datetime-local" value={vence} onChange={(e) => setVence(e.target.value)} required className={CLASE_INPUT} {...inv('vence_at')} />
          {err('vence_at')}
        </div>
      </div>
      {permiteJuridico && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 font-montserrat text-sm text-text-light">
            <input type="checkbox" checked={plazo} onChange={(e) => setPlazo(e.target.checked)} className="accent-gold" />
            Es un plazo jurídico (lo verifica el titular o Dirección)
          </label>
          {!plazo && (
            <label className="flex items-center gap-2 font-montserrat text-sm text-text-light">
              <input type="checkbox" checked={juridica} onChange={(e) => setJuridica(e.target.checked)} className="accent-gold" />
              Tarea jurídica (no visible para asistencia)
            </label>
          )}
        </div>
      )}
      {error && <Franja tipo="error">{error}</Franja>}
      <div className="flex gap-3">
        <button type="submit" disabled={guardando} className={BOTON_PRIMARIO}>{guardando ? 'Guardando…' : 'Crear tarea'}</button>
        <Link href={volverHref} className={BOTON_SECUNDARIO}>Volver</Link>
      </div>
    </form>
  )
}
