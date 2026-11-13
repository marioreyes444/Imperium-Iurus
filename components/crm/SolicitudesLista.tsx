'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ListaSeleccionable, { type Columna, type FiltroDef } from '@/components/crm/ListaSeleccionable'
import CambiarEstadoPanel from '@/components/crm/CambiarEstadoPanel'
import Franja from '@/components/crm/Franja'
import { IndicadorEstado, IndicadorUrgencia } from '@/components/crm/IndicadoresSolicitud'
import { formatoFecha } from '@/components/crm/formato'
import { BOTON_BARRA } from '@/components/crm/estilos'

export type FilaSolicitud = {
  id: string
  codigo: string
  contacto: string | null
  estado: string
  estado_etiqueta: string
  fase: string
  urgencia: string
  area: string | null
  requiere_validacion: boolean
  reserva_reforzada: boolean
  canal_origen?: string
  fecha_recepcion: string
}

type Props = {
  estados: { valor: string; etiqueta: string }[]
  urgencias: { valor: string; etiqueta: string }[]
  areas: { valor: string; etiqueta: string }[]
  /** Solo Dirección y Coordinación reciben la lista: sin ella no hay filtro «titular». */
  titulares?: { valor: string; etiqueta: string }[]
  puedeCrear: boolean
  puedeEditar: boolean
  puedeCambiarEstado: boolean
}

export default function SolicitudesLista({ estados, urgencias, areas, titulares, puedeCrear, puedeEditar, puedeCambiarEstado }: Props) {
  const router = useRouter()
  const [panelAbierto, setPanelAbierto] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const filtros: FiltroDef[] = [
    { nombre: 'estado', etiqueta: 'Estado', tipo: 'select', opciones: estados },
    { nombre: 'urgencia', etiqueta: 'Urgencia', tipo: 'select', opciones: urgencias },
    // El filtro por área solo aparece cuando el catálogo E5 ya tiene datos.
    ...(areas.length > 0 ? [{ nombre: 'area', etiqueta: 'Área', tipo: 'select' as const, opciones: areas }] : []),
    ...(titulares && titulares.length > 0 ? [{ nombre: 'titular', etiqueta: 'Titular', tipo: 'select' as const, opciones: titulares }] : []),
  ]

  const columnas: Columna<FilaSolicitud>[] = [
    {
      clave: 'codigo', titulo: 'Código', ancho: '11%',
      render: (f) => <>{f.codigo}{f.reserva_reforzada && <span className="ml-2 text-[10px] text-gold">· reservada</span>}</>,
      texto: (f) => f.codigo + (f.reserva_reforzada ? ' (reserva reforzada)' : ''),
    },
    { clave: 'contacto', titulo: 'Contacto', ancho: '24%', render: (f) => f.contacto ?? '—', texto: (f) => f.contacto ?? '' },
    { clave: 'estado', titulo: 'Estado', ancho: '22%', render: (f) => <IndicadorEstado etiqueta={f.estado_etiqueta} fase={f.fase} />, texto: (f) => f.estado_etiqueta },
    { clave: 'urgencia', titulo: 'Urgencia', ancho: '12%', render: (f) => <IndicadorUrgencia urgencia={f.urgencia} /> },
    {
      clave: 'area', titulo: 'Área', ancho: '19%',
      render: (f) => <>{f.area ?? '—'}{f.requiere_validacion && <span className="ml-2 text-[10px] text-text-muted/80">· por validar</span>}</>,
      texto: (f) => f.area ?? '',
    },
    { clave: 'recibida', titulo: 'Recibida', ancho: '12%', render: (f) => formatoFecha(f.fecha_recepcion) },
  ]

  return (
    <ListaSeleccionable<FilaSolicitud>
      titulo="Solicitudes"
      endpoint="/api/admin/crm/solicitudes"
      columnas={columnas}
      idDe={(f) => f.id}
      etiquetaSeleccion={(f) => `${f.codigo} · ${f.contacto ?? 'sin contacto'}`}
      singular="solicitud"
      plural="solicitudes"
      buscador={{ placeholder: 'Buscar por código o por datos del contacto' }}
      filtros={filtros}
      accionPrincipal={puedeCrear ? { href: '/admin/crm/solicitudes/nueva', etiqueta: '+ Nueva solicitud' } : undefined}
      onCambioSeleccion={() => setPanelAbierto(false)}
      vacio={<>Todavía no hay solicitudes. Llegan solas desde el formulario web y las citas, o puedes registrar una con «+ Nueva solicitud».</>}
      mensaje={mensaje ? <Franja tipo="exito">{mensaje}</Franja> : undefined}
      barraAcciones={(fila) => (
        <>
          <button type="button" disabled={!fila} onClick={() => fila && router.push(`/admin/crm/solicitudes/${fila.id}`)} className={BOTON_BARRA}>Ver</button>
          {puedeEditar && (
            <button type="button" disabled={!fila} onClick={() => fila && router.push(`/admin/crm/solicitudes/${fila.id}/editar`)} className={BOTON_BARRA}>Editar</button>
          )}
          {puedeCambiarEstado && (
            <button type="button" disabled={!fila} onClick={() => { setMensaje(null); setPanelAbierto(true) }} className={BOTON_BARRA}>Cambiar estado</button>
          )}
        </>
      )}
      panel={(fila, ctx) =>
        fila && panelAbierto ? (
          <CambiarEstadoPanel
            key={fila.id}
            solicitudId={fila.id}
            onCancelar={() => setPanelAbierto(false)}
            onHecho={(texto) => { setPanelAbierto(false); setMensaje(`${fila.codigo}: ${texto}`); ctx.recargar() }}
          />
        ) : null
      }
    />
  )
}
