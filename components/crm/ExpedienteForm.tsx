'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Franja from '@/components/crm/Franja'
import { BOTON_PRIMARIO, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

const CAMPOS: { clave: string; etiqueta: string; tipo?: 'date' | 'area'; max: number }[] = [
  { clave: 'numero_proceso', etiqueta: 'Número de proceso', max: 80 },
  { clave: 'autoridad', etiqueta: 'Autoridad', max: 200 },
  { clave: 'contraparte', etiqueta: 'Contraparte', max: 200 },
  { clave: 'etapa_procesal', etiqueta: 'Etapa procesal', max: 200 },
  { clave: 'estado_procesal', etiqueta: 'Estado procesal', max: 200 },
  { clave: 'ultimo_acto_at', etiqueta: 'Fecha del último acto', tipo: 'date', max: 10 },
  { clave: 'ultimo_acto', etiqueta: 'Último acto', tipo: 'area', max: 1000 },
]

type Valores = Record<string, string | null>

/** Expediente procesal (R-17: independiente del estado del caso). Editan D, C y el titular activo. */
export default function ExpedienteForm({ solicitudId, inicial, updatedAt, editable }: {
  solicitudId: string
  inicial: Valores
  updatedAt: string | null
  editable: boolean
}) {
  const router = useRouter()
  const [valores, setValores] = useState<Valores>(inicial)
  const [version, setVersion] = useState(updatedAt)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [exito, setExito] = useState(false)

  async function guardar() {
    setGuardando(true)
    setError(null)
    setCampos({})
    setExito(false)
    try {
      const res = await fetch(`/api/admin/crm/solicitudes/${solicitudId}/expediente`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...valores, updated_at: version }),
      })
      const cuerpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCampos(cuerpo.campos ?? {})
        setError(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo guardar el expediente.')
        return
      }
      setVersion(cuerpo.expediente?.updated_at ?? version)
      setExito(true)
      router.refresh()
    } catch {
      setError('No se pudo conectar. Inténtalo de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  if (!editable) {
    const hay = CAMPOS.some((c) => inicial[c.clave])
    return hay ? (
      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        {CAMPOS.map((c) => (
          <div key={c.clave} className={c.tipo === 'area' ? 'sm:col-span-2 xl:col-span-3' : ''}>
            <dt className="font-montserrat text-[10px] uppercase tracking-widest text-text-muted">{c.etiqueta}</dt>
            <dd className="mt-1 whitespace-pre-wrap font-montserrat text-sm text-text-light">{inicial[c.clave] || '—'}</dd>
          </div>
        ))}
      </dl>
    ) : <p className="font-montserrat text-xs text-text-muted">Este caso aún no tiene datos procesales.</p>
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void guardar() }} className="max-w-3xl space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {CAMPOS.map((c) => (
          <div key={c.clave} className={c.tipo === 'area' ? 'sm:col-span-2' : ''}>
            <label htmlFor={`ex-${c.clave}`} className={CLASE_ETIQUETA}>{c.etiqueta}</label>
            {c.tipo === 'area' ? (
              <textarea id={`ex-${c.clave}`} value={valores[c.clave] ?? ''} onChange={(e) => setValores((v) => ({ ...v, [c.clave]: e.target.value }))} rows={3} maxLength={c.max} className={CLASE_INPUT} />
            ) : (
              <input id={`ex-${c.clave}`} type={c.tipo ?? 'text'} value={valores[c.clave] ?? ''} onChange={(e) => setValores((v) => ({ ...v, [c.clave]: e.target.value }))} maxLength={c.max} className={CLASE_INPUT}
                aria-invalid={campos[c.clave] ? true : undefined} aria-describedby={campos[c.clave] ? `ex-${c.clave}-error` : undefined} />
            )}
            {campos[c.clave] && <p id={`ex-${c.clave}-error`} className="mt-1 font-montserrat text-xs text-red-400">{campos[c.clave]}</p>}
          </div>
        ))}
      </div>
      {error && <Franja tipo="error">{error}</Franja>}
      {exito && <Franja tipo="exito">Expediente guardado.</Franja>}
      <button type="submit" disabled={guardando} className={BOTON_PRIMARIO}>{guardando ? 'Guardando…' : 'Guardar expediente'}</button>
    </form>
  )
}
