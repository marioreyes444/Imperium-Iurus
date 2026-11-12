'use client'

import { useRouter } from 'next/navigation'
import ListaSeleccionable, { type Columna, type FiltroDef } from '@/components/crm/ListaSeleccionable'
import { formatoFecha } from '@/components/crm/formato'
import { BOTON_BARRA } from '@/components/crm/estilos'

type FichaResumen = { id: string; nombre: string; correo?: string | null; telefono?: string | null }

export type FilaDuplicado = {
  id: string
  coincidencia: 'telefono' | 'correo' | 'nombre'
  estado: string
  created_at: string
  a: FichaResumen
  b: FichaResumen
}

const ETIQUETA_COINCIDENCIA = { telefono: 'Mismo teléfono', correo: 'Mismo correo', nombre: 'Mismo nombre' } as const

export default function DuplicadosLista() {
  const router = useRouter()

  const filtros: FiltroDef[] = [
    {
      nombre: 'estado', etiqueta: 'Estado', tipo: 'select',
      opciones: [{ valor: 'pendiente', etiqueta: 'Pendientes' }, { valor: 'fusionado', etiqueta: 'Fusionados' }, { valor: 'descartado', etiqueta: 'Descartados' }],
    },
  ]

  const columnas: Columna<FilaDuplicado>[] = [
    { clave: 'a', titulo: 'Ficha A', ancho: '30%', render: (f) => f.a.nombre, texto: (f) => `${f.a.nombre} ${f.a.correo ?? ''} ${f.a.telefono ?? ''}` },
    { clave: 'b', titulo: 'Ficha B', ancho: '30%', render: (f) => f.b.nombre, texto: (f) => `${f.b.nombre} ${f.b.correo ?? ''} ${f.b.telefono ?? ''}` },
    { clave: 'coincidencia', titulo: 'Coincidencia', ancho: '20%', render: (f) => ETIQUETA_COINCIDENCIA[f.coincidencia] },
    { clave: 'fecha', titulo: 'Detectado', ancho: '20%', render: (f) => formatoFecha(f.created_at) },
  ]

  return (
    <ListaSeleccionable<FilaDuplicado>
      titulo="Duplicados"
      endpoint="/api/admin/crm/duplicados"
      columnas={columnas}
      idDe={(f) => f.id}
      etiquetaSeleccion={(f) => `${f.a.nombre} · ${f.b.nombre}`}
      singular="par"
      plural="pares"
      filtros={filtros}
      vacio={<>No hay posibles duplicados. Aparecen aquí cuando un teléfono o correo se repite entre dos fichas, o cuando alguien marca un par a mano.</>}
      barraAcciones={(fila) => (
        <button type="button" disabled={!fila} onClick={() => fila && router.push(`/admin/crm/duplicados/${fila.id}`)} className={BOTON_BARRA}>
          Comparar
        </button>
      )}
    />
  )
}
