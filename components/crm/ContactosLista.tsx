'use client'

import { useRouter } from 'next/navigation'
import ListaSeleccionable, { type Columna, type FiltroDef } from '@/components/crm/ListaSeleccionable'
import { formatoFecha } from '@/components/crm/formato'
import { BOTON_BARRA } from '@/components/crm/estilos'

export type FilaContacto = {
  id: string
  tipo: 'persona' | 'empresa'
  nombre: string
  completar_apellidos: boolean
  tipo_identificacion: string | null
  identificacion: string | null
  identificacion_validada: boolean
  telefono: string | null
  correo: string | null
  etapa_relacion: string
  reserva_reforzada: boolean
  fusionado_en: string | null
  created_at: string
}

type Props = {
  etapas: { valor: string; etiqueta: string }[]
  puedeCrear: boolean
  /** Edita cualquier ficha vigente (D, C, A) o solo las de sus casos (asociado): ambos ven el botón. */
  puedeEditar: boolean
}

export default function ContactosLista({ etapas, puedeCrear, puedeEditar }: Props) {
  const router = useRouter()
  const etiquetaEtapa = (v: string) => etapas.find((e) => e.valor === v)?.etiqueta ?? v

  const filtros: FiltroDef[] = [
    { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', opciones: [{ valor: 'persona', etiqueta: 'Personas' }, { valor: 'empresa', etiqueta: 'Empresas' }] },
    { nombre: 'etapa', etiqueta: 'Etapa', tipo: 'select', opciones: etapas },
  ]

  const columnas: Columna<FilaContacto>[] = [
    {
      clave: 'nombre', titulo: 'Nombre', ancho: '28%',
      render: (f) => (
        <>
          {f.nombre}
          {f.completar_apellidos && <span className="ml-2 text-[10px] text-text-muted/80">· completar apellidos</span>}
        </>
      ),
      texto: (f) => f.nombre + (f.completar_apellidos ? ' (completar apellidos)' : ''),
    },
    {
      clave: 'identificacion', titulo: 'Identificación', ancho: '17%',
      render: (f) => f.identificacion
        ? <>{f.identificacion}{f.tipo_identificacion === 'ruc' && !f.identificacion_validada && <span className="ml-2 text-[10px] text-text-muted/80">· no validado</span>}</>
        : '—',
      texto: (f) => f.identificacion ?? '',
    },
    { clave: 'telefono', titulo: 'Teléfono', ancho: '13%', render: (f) => f.telefono ?? '—', texto: (f) => f.telefono ?? '' },
    { clave: 'correo', titulo: 'Correo', ancho: '20%', render: (f) => f.correo ?? '—', texto: (f) => f.correo ?? '' },
    { clave: 'etapa', titulo: 'Etapa', ancho: '14%', render: (f) => etiquetaEtapa(f.etapa_relacion), texto: (f) => etiquetaEtapa(f.etapa_relacion) },
    { clave: 'alta', titulo: 'Alta', ancho: '8%', render: (f) => formatoFecha(f.created_at) },
  ]

  return (
    <ListaSeleccionable<FilaContacto>
      titulo="Contactos"
      endpoint="/api/admin/crm/contactos"
      columnas={columnas}
      idDe={(f) => f.id}
      etiquetaSeleccion={(f) => f.nombre}
      singular="contacto"
      plural="contactos"
      buscador={{ placeholder: 'Buscar por nombre, correo, teléfono o identificación' }}
      filtros={filtros}
      accionPrincipal={puedeCrear ? { href: '/admin/crm/contactos/nuevo', etiqueta: '+ Nuevo contacto' } : undefined}
      vacio={<>Todavía no hay contactos. Se crean solos cuando llega un formulario web o una cita, o puedes crear uno con «+ Nuevo contacto».</>}
      barraAcciones={(fila) => (
        <>
          <button type="button" disabled={!fila} onClick={() => fila && router.push(`/admin/crm/contactos/${fila.id}`)} className={BOTON_BARRA}>
            Ver
          </button>
          {puedeEditar && (
            <button type="button" disabled={!fila} onClick={() => fila && router.push(`/admin/crm/contactos/${fila.id}/editar`)} className={BOTON_BARRA}>
              Editar
            </button>
          )}
        </>
      )}
    />
  )
}
