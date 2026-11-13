'use client'

import { useState } from 'react'
import Franja from '@/components/crm/Franja'

/**
 * Descarga el CSV con `fetch` para poder mostrar los errores (422 o 502) en una franja dentro de la
 * página, sin perder los filtros. Si va bien, dispara la descarga con el nombre que envía el servidor.
 * `consulta` es la query string con el período y los filtros del reporte.
 */
export default function ExportarCsv({ consulta }: { consulta: string }) {
  const [descargando, setDescargando] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(null)

  async function exportar() {
    setDescargando(true)
    setMensaje(null)
    try {
      const res = await fetch(`/api/admin/crm/exportar?${consulta}`, { cache: 'no-store' })
      if (!res.ok) {
        const cuerpo = await res.json().catch(() => ({}))
        setMensaje({
          tipo: 'error',
          texto: typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo exportar. Inténtalo de nuevo.',
        })
        return
      }
      const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'solicitudes.csv'
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = nombre
      document.body.appendChild(enlace)
      enlace.click()
      enlace.remove()
      URL.revokeObjectURL(url)
      setMensaje({ tipo: 'exito', texto: `Exportación lista: ${nombre}. Quedó registrada en el Historial.` })
    } catch {
      setMensaje({ tipo: 'error', texto: 'No se pudo conectar. Inténtalo de nuevo.' })
    } finally {
      setDescargando(false)
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={exportar}
        disabled={descargando}
        className="focus-gold border border-gold px-5 py-2 font-montserrat text-[10px] font-bold uppercase tracking-widest text-gold transition-colors hover:bg-gold hover:text-primary disabled:opacity-60"
      >
        {descargando ? 'Exportando…' : 'Exportar CSV'}
      </button>
      {/* Región viva siempre presente: los lectores de pantalla anuncian el mensaje al aparecer. */}
      <div aria-live="polite">{mensaje && <Franja tipo={mensaje.tipo}>{mensaje.texto}</Franja>}</div>
    </div>
  )
}
