'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ListaSeleccionable, { type Columna, type FiltroDef } from '@/components/crm/ListaSeleccionable'
import Franja from '@/components/crm/Franja'
import Indicador from '@/components/crm/Indicador'
import { formatoFechaHora } from '@/components/crm/formato'
import { BOTON_BARRA } from '@/components/crm/estilos'

type FilaAviso = { id: string; tipo: string; titulo: string; url: string | null; leida_at: string | null; created_at: string }

/** Avisos del panel de la persona (pantalla agregada en la Entrega 4). */
export default function AvisosLista() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const filtros: FiltroDef[] = [{
    nombre: 'leidas', etiqueta: 'Mostrar', tipo: 'select',
    opciones: [{ valor: 'false', etiqueta: 'Sin leer' }, { valor: 'true', etiqueta: 'Leídos' }, { valor: 'todas', etiqueta: 'Todos' }],
  }]

  const columnas: Columna<FilaAviso>[] = [
    { clave: 'estado', titulo: 'Estado', ancho: '110px', render: (a) => <Indicador texto={a.leida_at ? 'Leído' : 'Sin leer'} relleno={a.leida_at ? 'ninguno' : 'dorado'} atenuado={!!a.leida_at} /> },
    { clave: 'titulo', titulo: 'Aviso', ancho: '60%', render: (a) => a.titulo, texto: (a) => a.titulo },
    { clave: 'fecha', titulo: 'Recibido', ancho: '180px', render: (a) => formatoFechaHora(a.created_at) },
  ]

  async function marcar(a: FilaAviso): Promise<boolean> {
    if (a.leida_at) return true
    setOcupado(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/crm/notificaciones/${a.id}/leida`, { method: 'POST' })
      if (!res.ok) {
        const cuerpo = await res.json().catch(() => ({}))
        setError(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo marcar el aviso.')
        return false
      }
      return true
    } catch {
      setError('No se pudo conectar. Inténtalo de nuevo.')
      return false
    } finally {
      setOcupado(false)
    }
  }

  return (
    <ListaSeleccionable<FilaAviso>
      titulo="Avisos"
      endpoint="/api/admin/crm/notificaciones"
      columnas={columnas}
      idDe={(a) => a.id}
      etiquetaSeleccion={(a) => a.titulo}
      singular="aviso"
      plural="avisos"
      filtros={filtros}
      mensaje={error ? <Franja tipo="error">{error}</Franja> : null}
      vacio={<>No tienes avisos con este filtro. Aquí llegan las asignaciones, citas, tareas y solicitudes críticas que te corresponden.</>}
      barraAcciones={(a, ctx) => (
        <>
          <button type="button" disabled={!a?.url || ocupado} className={BOTON_BARRA}
            onClick={async () => { if (a?.url && (await marcar(a))) router.push(a.url) }}>
            Abrir
          </button>
          <button type="button" disabled={!a || !!a.leida_at || ocupado} className={BOTON_BARRA}
            onClick={async () => { if (a && (await marcar(a))) { ctx.limpiarSeleccion(); ctx.recargar() } }}>
            Marcar como leído
          </button>
        </>
      )}
    />
  )
}
