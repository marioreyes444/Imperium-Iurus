'use client'

import { useEffect, useId, useState } from 'react'
import { Search } from 'lucide-react'
import { CLASE_ETIQUETA } from '@/components/crm/estilos'

export type ContactoElegido = {
  id: string
  nombre: string
  tipo: 'persona' | 'empresa'
  correo: string | null
  telefono: string | null
  identificacion: string | null
  reserva_reforzada: boolean
}

type Props = {
  etiqueta: string
  tipo?: 'persona' | 'empresa'
  excluirId?: string
  onElegir: (contacto: ContactoElegido) => void
}

/** Busca contactos en el servidor (sin tildes ni mayúsculas, ~250 ms tras la última tecla). */
export default function BuscadorContacto({ etiqueta, tipo, excluirId, onElegir }: Props) {
  const idCampo = useId()
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<ContactoElegido[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const texto = q.trim()
    if (texto.length < 2) {
      setResultados([])
      setError(null)
      return
    }
    let vigente = true
    const t = setTimeout(async () => {
      setCargando(true)
      setError(null)
      try {
        const p = new URLSearchParams({ q: texto, limite: '8' })
        if (tipo) p.set('tipo', tipo)
        const res = await fetch(`/api/admin/crm/contactos?${p.toString()}`, { cache: 'no-store' })
        const cuerpo = await res.json().catch(() => ({}))
        if (!vigente) return
        if (!res.ok) {
          setError(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo buscar.')
          setResultados([])
          return
        }
        setResultados(
          (cuerpo.items as (ContactoElegido & { nombre: string })[]).filter((c) => c.id !== excluirId),
        )
      } catch {
        if (vigente) setError('No se pudo conectar con el servidor.')
      } finally {
        if (vigente) setCargando(false)
      }
    }, 250)
    return () => { vigente = false; clearTimeout(t) }
  }, [q, tipo, excluirId])

  return (
    <div>
      <label htmlFor={idCampo} className={CLASE_ETIQUETA}>{etiqueta}</label>
      <div className="relative">
        <Search size={14} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          id={idCampo}
          type="search"
          value={q}
          maxLength={80}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nombre, correo, teléfono o identificación"
          className="focus-gold w-full border border-border bg-card-bg py-2.5 pl-9 pr-3 font-montserrat text-xs text-text-light placeholder-text-muted/60 focus:border-gold"
        />
      </div>
      <div aria-live="polite" className="mt-2">
        {cargando && <p className="font-montserrat text-xs text-text-muted">Buscando…</p>}
        {error && <p role="alert" className="font-montserrat text-xs text-red-400">{error}</p>}
        {!cargando && !error && q.trim().length >= 2 && resultados.length === 0 && (
          <p className="font-montserrat text-xs text-text-muted">Sin resultados.</p>
        )}
        {resultados.length > 0 && (
          <ul className="divide-y divide-border border border-border bg-card-bg">
            {resultados.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onElegir(c)}
                  className="focus-gold flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left font-montserrat text-xs text-text-light transition-colors hover:bg-gold/10"
                >
                  <span className="min-w-0 flex-1 truncate">{c.nombre}</span>
                  <span className="shrink-0 truncate text-text-muted">{c.correo ?? c.telefono ?? c.identificacion ?? ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
