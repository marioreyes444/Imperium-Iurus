'use client'

import { useRouter } from 'next/navigation'
import ListaSeleccionable, { type Columna, type FiltroDef } from '@/components/crm/ListaSeleccionable'
import { BOTON_BARRA } from '@/components/crm/estilos'

export type FilaPersonal = {
  id: string
  rol: string
  nombres: string
  apellidos: string
  correo: string | null
  ciudad: string | null
  es_abogado: boolean
  matricula: string | null
  habilitacion_verificada: boolean
  capacidad_maxima: number | null
  carga_titular: number
  casos_apoyo: number
  tareas_vencidas: number
}

type Props = { roles: { valor: string; etiqueta: string }[] }

export default function PersonalLista({ roles }: Props) {
  const router = useRouter()
  const etiquetaRol = (r: string) => roles.find((x) => x.valor === r)?.etiqueta ?? r

  const filtros: FiltroDef[] = [
    { nombre: 'rol', etiqueta: 'Rol', tipo: 'select', opciones: roles },
    { nombre: 'abogados', etiqueta: 'Tipo', tipo: 'select', opciones: [{ valor: 'true', etiqueta: 'Solo abogados' }] },
  ]

  const columnas: Columna<FilaPersonal>[] = [
    { clave: 'nombre', titulo: 'Nombre', ancho: '26%', render: (f) => `${f.nombres} ${f.apellidos}`, texto: (f) => `${f.nombres} ${f.apellidos}` },
    { clave: 'rol', titulo: 'Rol', ancho: '14%', render: (f) => etiquetaRol(f.rol) },
    { clave: 'matricula', titulo: 'Matrícula', ancho: '14%', render: (f) => f.matricula ?? '—', texto: (f) => f.matricula ?? '' },
    {
      clave: 'habilitacion', titulo: 'Habilitación', ancho: '16%',
      render: (f) => (f.es_abogado ? (f.habilitacion_verificada ? 'Verificada' : 'Sin verificar') : '—'),
    },
    {
      clave: 'carga', titulo: 'Carga / capacidad', ancho: '16%',
      render: (f) => (f.es_abogado ? `${f.carga_titular} de ${f.capacidad_maxima ?? 'sin límite'}` : '—'),
    },
    { clave: 'ciudad', titulo: 'Ciudad', ancho: '14%', render: (f) => f.ciudad ?? '—', texto: (f) => f.ciudad ?? '' },
  ]

  return (
    <ListaSeleccionable<FilaPersonal>
      titulo="Personal"
      endpoint="/api/admin/crm/personal"
      columnas={columnas}
      idDe={(f) => f.id}
      etiquetaSeleccion={(f) => `${f.nombres} ${f.apellidos} · ${etiquetaRol(f.rol)}`}
      singular="persona"
      plural="personas"
      buscador={{ placeholder: 'Buscar por nombre, correo o matrícula' }}
      filtros={filtros}
      vacio={<>No hay personal con esos criterios. Las cuentas nuevas se crean en «Usuarios» (solo Dirección).</>}
      barraAcciones={(fila) => (
        <>
          <button type="button" disabled={!fila} onClick={() => fila && router.push(`/admin/crm/personal/${fila.id}`)} className={BOTON_BARRA}>Ver</button>
          <button type="button" disabled={!fila} onClick={() => fila && router.push(`/admin/crm/personal/${fila.id}/editar`)} className={BOTON_BARRA}>Editar</button>
        </>
      )}
    />
  )
}
