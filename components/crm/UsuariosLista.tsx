'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ListaSeleccionable, { type Columna, type FiltroDef } from '@/components/crm/ListaSeleccionable'
import PanelAccion from '@/components/crm/PanelAccion'
import Franja from '@/components/crm/Franja'
import Indicador from '@/components/crm/Indicador'
import { formatoFecha } from '@/components/crm/formato'

export type FilaUsuario = {
  id: string
  rol: string
  nombres: string
  apellidos: string
  correo: string | null
  activo: boolean
  sin_cuenta: boolean
  created_at: string
  updated_at: string
}

type Afectados = {
  casos: { solicitud_id: string; codigo: string | null; estado: string | null }[]
  citas: { id: string; fecha: string; hora: string }[]
  incompleto: boolean
}

type Props = {
  /** Ficha de quien consulta: no puede actuar sobre su propia cuenta. */
  miId: string
  roles: { valor: string; etiqueta: string }[]
  aviso?: 'creado' | 'editado'
}

const AVISOS: Record<NonNullable<Props['aviso']>, string> = {
  creado:
    'Ficha creada. La invitación por correo aún no está disponible: la persona todavía no tiene cuenta de acceso.',
  editado: 'Cambios guardados.',
}

type Accion = 'desactivar' | 'reactivar'

export default function UsuariosLista({ miId, roles, aviso }: Props) {
  const router = useRouter()
  const etiquetaRol = (v: string) => roles.find((r) => r.valor === v)?.etiqueta ?? v

  const [accion, setAccion] = useState<Accion | null>(null)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [errorPanel, setErrorPanel] = useState<string | null>(null)
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<{ tipo: 'exito' | 'error'; texto: string; afectados?: Afectados } | null>(
    aviso ? { tipo: 'exito', texto: AVISOS[aviso] } : null,
  )

  const filtros: FiltroDef[] = [
    { nombre: 'rol', etiqueta: 'Rol', tipo: 'select', opciones: roles },
    {
      nombre: 'activo', etiqueta: 'Estado', tipo: 'select',
      opciones: [{ valor: 'true', etiqueta: 'Activos' }, { valor: 'false', etiqueta: 'Inactivos' }],
    },
  ]

  const columnas: Columna<FilaUsuario>[] = [
    {
      clave: 'nombre', titulo: 'Nombre', ancho: '26%',
      render: (f) => `${f.nombres} ${f.apellidos}`,
      texto: (f) => `${f.nombres} ${f.apellidos}`,
    },
    { clave: 'correo', titulo: 'Correo', ancho: '28%', render: (f) => f.correo ?? '—', texto: (f) => f.correo ?? '' },
    { clave: 'rol', titulo: 'Rol', ancho: '14%', render: (f) => etiquetaRol(f.rol) },
    {
      clave: 'estado', titulo: 'Estado', ancho: '18%',
      render: (f) => (
        <Indicador
          forma="punto"
          relleno={f.activo ? 'claro' : 'atenuado'}
          atenuado={!f.activo}
          texto={`${f.activo ? 'Activo' : 'Inactivo'}${f.sin_cuenta ? ' · sin cuenta' : ''}`}
        />
      ),
      texto: (f) => `${f.activo ? 'Activo' : 'Inactivo'}${f.sin_cuenta ? ' · sin cuenta' : ''}`,
    },
    { clave: 'alta', titulo: 'Alta', ancho: '14%', render: (f) => formatoFecha(f.created_at) },
  ]

  function cerrarPanel() {
    setAccion(null)
    setMotivo('')
    setErrorPanel(null)
    setErrorMotivo(null)
  }

  async function ejecutar(fila: FilaUsuario, recargar: () => void) {
    if (!accion) return
    setGuardando(true)
    setErrorPanel(null)
    setErrorMotivo(null)
    try {
      const res = await fetch(`/api/admin/crm/usuarios/${fila.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updated_at: fila.updated_at,
          activo: accion === 'reactivar',
          motivo: motivo.trim() || undefined,
        }),
      })
      const cuerpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (cuerpo.campos?.motivo) setErrorMotivo(cuerpo.campos.motivo)
        else setErrorPanel(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo completar la acción.')
        if (res.status === 409) recargar()
        return
      }
      const nombre = `${fila.nombres} ${fila.apellidos}`
      setMensaje({
        tipo: 'exito',
        texto: accion === 'desactivar'
          ? `${nombre} fue desactivado/a y perderá el acceso en su siguiente petición.`
          : `${nombre} fue reactivado/a.`,
        afectados: cuerpo.afectados,
      })
      cerrarPanel()
      recargar()
      router.refresh()
    } catch {
      setErrorPanel('No se pudo conectar con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <ListaSeleccionable<FilaUsuario>
      titulo="Usuarios"
      endpoint="/api/admin/crm/usuarios"
      columnas={columnas}
      idDe={(f) => f.id}
      etiquetaSeleccion={(f) => `${f.nombres} ${f.apellidos}`}
      singular="usuario"
      plural="usuarios"
      buscador={{ placeholder: 'Buscar por nombre o correo' }}
      filtros={filtros}
      accionPrincipal={{ href: '/admin/crm/usuarios/nuevo', etiqueta: '+ Nuevo usuario' }}
      onCambioSeleccion={cerrarPanel}
      vacio={<>Todavía no hay personal registrado. Crea la primera ficha con «+ Nuevo usuario».</>}
      mensaje={
        mensaje && (
          <div className="space-y-2">
            <Franja tipo={mensaje.tipo}>{mensaje.texto}</Franja>
            {mensaje.afectados && (mensaje.afectados.casos.length > 0 || mensaje.afectados.citas.length > 0) && (
              <Franja tipo="info">
                Esta persona tiene trabajo pendiente que debe reasignarse o reagendarse a mano:
                {' '}{mensaje.afectados.casos.length} caso(s) activo(s)
                {mensaje.afectados.casos.length > 0 && ` (${mensaje.afectados.casos.map((c) => c.codigo ?? '—').join(', ')})`}
                {' '}y {mensaje.afectados.citas.length} cita(s) futura(s).
              </Franja>
            )}
            {mensaje.afectados?.incompleto && (
              <Franja tipo="info">
                No se pudo comprobar todo el trabajo pendiente de esta persona (módulo de casos o citas aún no disponible).
              </Franja>
            )}
          </div>
        )
      }
      barraAcciones={(fila) => {
        const esYo = fila?.id === miId
        return (
          <>
            <button
              type="button"
              disabled={!fila}
              onClick={() => fila && router.push(`/admin/crm/usuarios/${fila.id}/editar`)}
              className="focus-gold border border-border px-4 py-1.5 font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-light transition-colors enabled:hover:border-gold enabled:hover:text-gold disabled:opacity-40"
            >
              Editar
            </button>
            {fila?.activo !== false ? (
              <button
                type="button"
                disabled={!fila || esYo}
                title={esYo ? 'No puedes desactivar tu propia cuenta' : undefined}
                onClick={() => { setMensaje(null); setAccion('desactivar') }}
                className="focus-gold border border-border px-4 py-1.5 font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-light transition-colors enabled:hover:border-red-500/60 enabled:hover:text-red-400 disabled:opacity-40"
              >
                Desactivar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { setMensaje(null); setAccion('reactivar') }}
                className="focus-gold border border-border px-4 py-1.5 font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-light transition-colors hover:border-gold hover:text-gold"
              >
                Reactivar
              </button>
            )}
          </>
        )
      }}
      panel={(fila, ctx) => {
        if (!fila || !accion) return null
        const nombre = `${fila.nombres} ${fila.apellidos}`
        const desactivando = accion === 'desactivar'
        return (
          <PanelAccion
            titulo={desactivando ? `Desactivar a ${nombre}` : `Reactivar a ${nombre}`}
            delicada={desactivando}
            etiquetaGuardar={desactivando ? 'Desactivar' : 'Reactivar'}
            guardando={guardando}
            error={errorPanel}
            onGuardar={() => ejecutar(fila, ctx.recargar)}
            onCancelar={cerrarPanel}
            resumen={desactivando
              ? 'La cuenta queda bloqueada y la persona pierde el acceso al CRM en su siguiente petición. No se cancela ni se reasigna nada automáticamente: se te mostrará la lista de casos y citas que tenga pendientes.'
              : 'La persona recupera el acceso al CRM con su rol actual.'}
          >
            <div>
              <label htmlFor="crm-motivo" className="mb-1 block font-montserrat text-[10px] uppercase tracking-widest text-text-muted">
                Motivo{desactivando ? ' (obligatorio)' : ' (opcional)'}
              </label>
              <textarea
                id="crm-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                maxLength={500}
                aria-invalid={errorMotivo ? true : undefined}
                aria-describedby={errorMotivo ? 'crm-motivo-error' : undefined}
                className="focus-gold w-full border border-border bg-primary px-3 py-2 font-montserrat text-xs text-text-light focus:border-gold"
              />
              {errorMotivo && (
                <p id="crm-motivo-error" className="mt-1 font-montserrat text-xs text-red-400">{errorMotivo}</p>
              )}
            </div>
          </PanelAccion>
        )
      }}
    />
  )
}
