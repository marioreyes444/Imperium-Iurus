'use client'

import { useState } from 'react'
import Link from 'next/link'
import ListaSeleccionable, { type Columna, type FiltroDef } from '@/components/crm/ListaSeleccionable'
import TareaAcciones, { type TareaAccionable } from '@/components/crm/TareaAcciones'
import Franja from '@/components/crm/Franja'
import Indicador from '@/components/crm/Indicador'
import { formatoFechaHora } from '@/components/crm/formato'
import { BOTON_BARRA } from '@/components/crm/estilos'

export type FilaTarea = TareaAccionable & {
  solicitud_id: string | null
  codigo: string | null
  responsable: string | null
  vence_at: string | null
  estado_tarea: string | null
  plazo_verificado_at: string | null
  created_at: string
}

const ESTADO: Record<string, string> = { pendiente: 'Pendiente', hecha: 'Hecha', cancelada: 'Cancelada' }

/**
 * Bandeja de tareas (sección 9.3). R-42: con estado «pendiente», los plazos jurídicos verificados van
 * primero (el orden lo da el servidor).
 */
export default function TareasLista({ verTodas }: { verTodas: boolean }) {
  const [mensaje, setMensaje] = useState<string | null>(null)
  const ahora = Date.now()

  const filtros: FiltroDef[] = [
    ...(verTodas ? [{
      nombre: 'tareas', etiqueta: 'Mostrar', tipo: 'select' as const,
      opciones: [{ valor: 'mias', etiqueta: 'Mis tareas' }, { valor: 'todas', etiqueta: 'Todas las de mis casos' }],
    }] : []),
    {
      nombre: 'estado', etiqueta: 'Estado', tipo: 'select',
      opciones: [{ valor: 'pendiente', etiqueta: 'Pendientes' }, { valor: 'hecha', etiqueta: 'Hechas' }, { valor: 'cancelada', etiqueta: 'Canceladas' }, { valor: 'todas', etiqueta: 'Todas' }],
    },
  ]

  const columnas: Columna<FilaTarea>[] = [
    {
      clave: 'vence', titulo: 'Vence', ancho: '170px',
      render: (t) => {
        const vencida = t.estado_tarea === 'pendiente' && !!t.vence_at && Date.parse(t.vence_at) < ahora
        return <Indicador texto={t.vence_at ? formatoFechaHora(t.vence_at) : '—'} forma="cuadrado" relleno={vencida ? 'rojo' : 'ninguno'} resaltado={vencida} />
      },
      texto: (t) => (t.vence_at ? formatoFechaHora(t.vence_at) : ''),
    },
    { clave: 'descripcion', titulo: 'Tarea', ancho: '38%', render: (t) => t.descripcion, texto: (t) => t.descripcion },
    {
      clave: 'plazo', titulo: 'Tipo', ancho: '150px',
      render: (t) => t.es_plazo_juridico
        ? <Indicador texto={t.plazo_verificado_at ? 'Plazo verificado' : 'Plazo por verificar'} relleno={t.plazo_verificado_at ? 'dorado' : 'contorno'} />
        : <span className="text-text-muted">Seguimiento</span>,
    },
    { clave: 'caso', titulo: 'Caso', ancho: '110px', render: (t) => t.codigo ?? '—' },
    { clave: 'responsable', titulo: 'Responsable', ancho: '18%', render: (t) => t.responsable ?? '—', texto: (t) => t.responsable ?? '' },
    { clave: 'estado', titulo: 'Estado', ancho: '100px', render: (t) => ESTADO[t.estado_tarea ?? ''] ?? '—' },
  ]

  return (
    <ListaSeleccionable<FilaTarea>
      titulo="Tareas"
      endpoint="/api/admin/crm/actividades"
      parametrosFijos={verTodas ? undefined : { tareas: 'mias' }}
      columnas={columnas}
      idDe={(t) => t.id}
      etiquetaSeleccion={(t) => `${t.codigo ? `${t.codigo} · ` : ''}${t.descripcion}`}
      singular="tarea"
      plural="tareas"
      filtros={filtros}
      accionPrincipal={verTodas ? { href: '/admin/crm/tareas/nueva', etiqueta: '+ Nueva tarea' } : undefined}
      onCambioSeleccion={() => setMensaje(null)}
      mensaje={mensaje ? <Franja tipo="exito">{mensaje}</Franja> : null}
      vacio={<>No hay tareas con estos filtros. Las tareas se crean desde la cronología de cada caso o con «Nueva tarea»; cancelar una cita crea la de reagendar.</>}
      barraAcciones={(t) => (
        t?.solicitud_id
          ? <Link href={`/admin/crm/solicitudes/${t.solicitud_id}?tab=cronologia`} className={BOTON_BARRA}>Ver caso</Link>
          : <button type="button" disabled className={BOTON_BARRA}>Ver caso</button>
      )}
      panel={(t, ctx) => (
        <TareaAcciones tarea={t} onHecho={(m) => { setMensaje(m); ctx.limpiarSeleccion(); ctx.recargar() }} />
      )}
    />
  )
}
