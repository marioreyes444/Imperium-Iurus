'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

type Fila = { id: string; codigo: string; contacto: string | null; estado_etiqueta?: string }

/** Buscador de un caso visible (usa la búsqueda de solicitudes, que ya aplica la visibilidad). */
export default function ElegirSolicitud({ prefijo }: { /** Se le añade el id del caso elegido. */ prefijo: string }) {
  const destino = (id: string) => `${prefijo}${id}`
  const [q, setQ] = useState('')
  const [filas, setFilas] = useState<Fila[]>([])
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    const t = setTimeout(async () => {
      setCargando(true)
      try {
        const p = new URLSearchParams({ limite: '20' })
        if (q.trim()) p.set('q', q.trim())
        const res = await fetch(`/api/admin/crm/solicitudes?${p}`, { cache: 'no-store' })
        const cuerpo = await res.json().catch(() => ({}))
        setFilas(res.ok ? ((cuerpo.items ?? []) as Fila[]) : [])
      } finally {
        setCargando(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <label htmlFor="es-q" className={CLASE_ETIQUETA}>Busca el caso por código o contacto</label>
        <input id="es-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} className={CLASE_INPUT} placeholder="S26-0041, nombre, correo…" />
      </div>
      <div aria-live="polite">
        {cargando && <p className="font-montserrat text-xs text-text-muted">Buscando…</p>}
        {!cargando && filas.length === 0 && <p className="font-montserrat text-xs text-text-muted">No hay casos que coincidan.</p>}
      </div>
      {filas.length > 0 && (
        <ul className="divide-y divide-border border border-border bg-card-bg">
          {filas.map((f) => (
            <li key={f.id}>
              <Link href={destino(f.id)} className="focus-gold block px-5 py-3 font-montserrat text-xs text-text-light hover:bg-white/5">
                <span className="text-gold">{f.codigo}</span>{f.contacto ? ` · ${f.contacto}` : ''}{f.estado_etiqueta ? ` · ${f.estado_etiqueta}` : ''}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
