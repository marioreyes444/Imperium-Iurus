'use client'

import { useState } from 'react'
import ListaSeleccionable, { type Columna, type FiltroDef } from '@/components/crm/ListaSeleccionable'
import PanelAccion from '@/components/crm/PanelAccion'
import { formatoFechaHora } from '@/components/crm/formato'

export type FilaBitacora = {
  id: number
  accion: string
  entidad: string
  entidad_id: string | null
  usuario: string | null
  motivo: string | null
  valores_antes: unknown
  valores_despues: unknown
  detalle: unknown
  created_at: string
}

type Props = {
  acciones: string[]
  usuarios: { valor: string; etiqueta: string }[]
}

const ETIQUETA_ACCION: Record<string, string> = {
  crear: 'Crear',
  actualizar: 'Actualizar',
  cambiar_estado: 'Cambiar estado',
  crear_usuario: 'Crear usuario',
  cambiar_rol: 'Cambiar rol',
  desactivar_usuario: 'Desactivar usuario',
  reactivar_usuario: 'Reactivar usuario',
  ver_reservado: 'Ver caso reservado',
}

const etiquetaAccion = (a: string) =>
  ETIQUETA_ACCION[a] ?? a.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

const json = (v: unknown) => (v === null || v === undefined ? '—' : JSON.stringify(v, null, 2))

export default function BitacoraLista({ acciones, usuarios }: Props) {
  const [verDetalle, setVerDetalle] = useState(false)

  const filtros: FiltroDef[] = [
    { nombre: 'accion', etiqueta: 'Acción', tipo: 'select', opciones: acciones.map((a) => ({ valor: a, etiqueta: etiquetaAccion(a) })) },
    { nombre: 'usuario', etiqueta: 'Usuario', tipo: 'select', opciones: usuarios },
    { nombre: 'entidad', etiqueta: 'Entidad', tipo: 'select', opciones: [
      { valor: 'crm_personal', etiqueta: 'Personal' },
      { valor: 'crm_solicitudes', etiqueta: 'Solicitud' },
      { valor: 'crm_contactos', etiqueta: 'Contacto' },
      { valor: 'citas', etiqueta: 'Cita' },
    ] },
    { nombre: 'desde', etiqueta: 'Desde', tipo: 'date' },
    { nombre: 'hasta', etiqueta: 'Hasta', tipo: 'date' },
  ]

  const columnas: Columna<FilaBitacora>[] = [
    { clave: 'fecha', titulo: 'Fecha', ancho: '18%', render: (f) => formatoFechaHora(f.created_at), texto: (f) => formatoFechaHora(f.created_at) },
    { clave: 'accion', titulo: 'Acción', ancho: '20%', render: (f) => etiquetaAccion(f.accion), texto: (f) => etiquetaAccion(f.accion) },
    { clave: 'entidad', titulo: 'Entidad', ancho: '12%', render: (f) => f.entidad },
    { clave: 'usuario', titulo: 'Usuario', ancho: '20%', render: (f) => f.usuario ?? 'Automático', texto: (f) => f.usuario ?? 'Automático' },
    { clave: 'motivo', titulo: 'Motivo', ancho: '30%', render: (f) => f.motivo ?? '—', texto: (f) => f.motivo ?? '' },
  ]

  return (
    <ListaSeleccionable<FilaBitacora>
      titulo="Historial"
      endpoint="/api/admin/crm/bitacora"
      columnas={columnas}
      idDe={(f) => String(f.id)}
      etiquetaSeleccion={(f) => `${etiquetaAccion(f.accion)} · ${formatoFechaHora(f.created_at)}`}
      singular="registro"
      plural="registros"
      filtros={filtros}
      onCambioSeleccion={() => setVerDetalle(false)}
      vacio={<>Aún no hay actividad registrada. Cada acción del CRM aparecerá aquí.</>}
      barraAcciones={(fila) => (
        <button
          type="button"
          disabled={!fila}
          onClick={() => setVerDetalle(true)}
          className="focus-gold border border-border px-4 py-1.5 font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-light transition-colors enabled:hover:border-gold enabled:hover:text-gold disabled:opacity-40"
        >
          Ver detalle
        </button>
      )}
      panel={(fila) => {
        if (!fila || !verDetalle) return null
        return (
          <PanelAccion titulo={`Detalle · ${etiquetaAccion(fila.accion)}`} etiquetaGuardar="Cerrar" onGuardar={() => setVerDetalle(false)} onCancelar={() => setVerDetalle(false)}>
            <dl className="grid gap-3 font-montserrat text-xs sm:grid-cols-2">
              <div>
                <dt className="mb-1 text-[10px] uppercase tracking-widest text-text-muted">Antes</dt>
                <dd><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-text-light">{json(fila.valores_antes)}</pre></dd>
              </div>
              <div>
                <dt className="mb-1 text-[10px] uppercase tracking-widest text-text-muted">Después</dt>
                <dd><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-text-light">{json(fila.valores_despues)}</pre></dd>
              </div>
              {fila.detalle !== null && fila.detalle !== undefined && (
                <div className="sm:col-span-2">
                  <dt className="mb-1 text-[10px] uppercase tracking-widest text-text-muted">Detalle</dt>
                  <dd><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-text-light">{json(fila.detalle)}</pre></dd>
                </div>
              )}
            </dl>
          </PanelAccion>
        )
      }}
    />
  )
}
