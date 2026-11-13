'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Franja from '@/components/crm/Franja'
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

const TIPOS = [
  { valor: 'semana', etiqueta: 'Entre semana' },
  { valor: 'fin_de_semana', etiqueta: 'Fin de semana' },
  { valor: 'feriado', etiqueta: 'Feriado' },
]

/** Formulario de un turno, en página propia (sin ventanas flotantes). */
export default function TurnoForm({ abogados, volverHref }: { abogados: { id: string; nombre: string }[]; volverHref: string }) {
  const router = useRouter()
  const [personal, setPersonal] = useState('')
  const [tipo, setTipo] = useState('semana')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  /**
   * Vuelve al listado con sus filtros (viven en la URL del listado, como en el resto del CRM). Si se
   * entró directo a esta página, no hay historial al que volver: va al listado sin filtros.
   */
  function volver() {
    if (window.history.length > 1) router.back()
    else router.push(volverHref)
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setGuardando(true)
    setError(null)
    setCampos({})
    try {
      const res = await fetch('/api/admin/crm/turnos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personal_id: personal, tipo, desde, hasta }),
      })
      const cuerpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCampos(cuerpo.campos ?? {})
        setError(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo guardar el turno.')
        return
      }
      volver()
    } catch {
      setError('No se pudo conectar. Inténtalo de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const campo = (id: string, nombre: string) => ({
    'aria-invalid': campos[nombre] ? true : undefined,
    'aria-describedby': campos[nombre] ? `${id}-error` : undefined,
  })
  const mensaje = (id: string, nombre: string) =>
    campos[nombre] ? <p id={`${id}-error`} className="mt-1 font-montserrat text-xs text-red-400">{campos[nombre]}</p> : null

  return (
    <form onSubmit={guardar} noValidate className="max-w-2xl space-y-5">
      {error && <Franja tipo="error">{error}</Franja>}

      <div>
        <label htmlFor="tu-personal" className={CLASE_ETIQUETA}>Abogado</label>
        <select id="tu-personal" value={personal} onChange={(e) => setPersonal(e.target.value)} required className={CLASE_INPUT} {...campo('tu-personal', 'personal_id')}>
          <option value="">Elige un abogado</option>
          {abogados.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
        {mensaje('tu-personal', 'personal_id')}
      </div>

      <div>
        <label htmlFor="tu-tipo" className={CLASE_ETIQUETA}>Tipo de turno</label>
        <select id="tu-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={CLASE_INPUT} {...campo('tu-tipo', 'tipo')}>
          {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
        </select>
        {mensaje('tu-tipo', 'tipo')}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="tu-desde" className={CLASE_ETIQUETA}>Desde (hora de Guayaquil)</label>
          <input id="tu-desde" type="datetime-local" value={desde} onChange={(e) => setDesde(e.target.value)} required className={CLASE_INPUT} {...campo('tu-desde', 'desde')} />
          {mensaje('tu-desde', 'desde')}
        </div>
        <div>
          <label htmlFor="tu-hasta" className={CLASE_ETIQUETA}>Hasta (hora de Guayaquil)</label>
          <input id="tu-hasta" type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} required className={CLASE_INPUT} {...campo('tu-hasta', 'hasta')} />
          {mensaje('tu-hasta', 'hasta')}
        </div>
      </div>

      <p className="font-montserrat text-xs leading-relaxed text-text-muted">
        Varias personas pueden tener turno al mismo tiempo (todas reciben el aviso de una solicitud crítica), pero la misma persona no puede tener dos turnos que se crucen.
      </p>

      <div className="flex gap-3">
        <button type="submit" disabled={guardando} className={BOTON_PRIMARIO}>{guardando ? 'Guardando…' : 'Guardar turno'}</button>
        <button type="button" onClick={volver} disabled={guardando} className={BOTON_SECUNDARIO}>Volver</button>
      </div>
    </form>
  )
}
