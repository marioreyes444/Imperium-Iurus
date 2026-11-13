'use client'

import { useState } from 'react'
import ListaSeleccionable, { type Columna, type FiltroDef } from '@/components/crm/ListaSeleccionable'
import PanelAccion from '@/components/crm/PanelAccion'
import Franja from '@/components/crm/Franja'
import Indicador from '@/components/crm/Indicador'
import { formatoFechaHora } from '@/components/crm/formato'
import { BOTON_BARRA } from '@/components/crm/estilos'

export type FilaTurno = {
  id: string
  personal_id: string
  persona: string
  tipo: string
  desde: string
  hasta: string
  vigente: boolean
  terminado: boolean
}

const TIPO: Record<string, string> = { semana: 'Entre semana', fin_de_semana: 'Fin de semana', feriado: 'Feriado' }

/** Turnos de abogados fuera de horario (R-16). «Quitar turno» solo en los que no han terminado. */
export default function TurnosLista({ personas }: { personas: { id: string; nombre: string }[] }) {
  const [mensaje, setMensaje] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(null)
  const [panel, setPanel] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtros: FiltroDef[] = [
    { nombre: 'vigencia', etiqueta: 'Mostrar', tipo: 'select', opciones: [{ valor: 'vigentes', etiqueta: 'Vigentes y futuros' }, { valor: 'terminados', etiqueta: 'Terminados' }] },
    { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', opciones: Object.entries(TIPO).map(([valor, etiqueta]) => ({ valor, etiqueta })) },
    { nombre: 'persona', etiqueta: 'Persona', tipo: 'select', opciones: personas.map((p) => ({ valor: p.id, etiqueta: p.nombre })) },
  ]

  const columnas: Columna<FilaTurno>[] = [
    { clave: 'persona', titulo: 'Abogado', ancho: '26%', render: (t) => t.persona, texto: (t) => t.persona },
    { clave: 'tipo', titulo: 'Tipo', ancho: '140px', render: (t) => TIPO[t.tipo] ?? t.tipo },
    { clave: 'desde', titulo: 'Desde', ancho: '190px', render: (t) => formatoFechaHora(t.desde), texto: (t) => formatoFechaHora(t.desde) },
    { clave: 'hasta', titulo: 'Hasta', ancho: '190px', render: (t) => formatoFechaHora(t.hasta), texto: (t) => formatoFechaHora(t.hasta) },
    {
      clave: 'estado', titulo: 'Estado', ancho: '140px',
      render: (t) => (t.vigente
        ? <Indicador texto="De turno ahora" relleno="dorado" resaltado />
        : t.terminado ? <Indicador texto="Terminado" relleno="atenuado" atenuado /> : <Indicador texto="Próximo" relleno="contorno" />),
    },
  ]

  return (
    <ListaSeleccionable<FilaTurno>
      titulo="Turnos"
      endpoint="/api/admin/crm/turnos"
      columnas={columnas}
      idDe={(t) => t.id}
      etiquetaSeleccion={(t) => `${t.persona} · ${TIPO[t.tipo] ?? t.tipo} · ${formatoFechaHora(t.desde)}`}
      singular="turno"
      plural="turnos"
      filtros={filtros}
      accionPrincipal={{ href: '/admin/crm/turnos/nuevo', etiqueta: '+ Nuevo turno' }}
      onCambioSeleccion={() => { setPanel(false); setError(null) }}
      mensaje={mensaje ? <Franja tipo={mensaje.tipo}>{mensaje.texto}</Franja> : null}
      vacio={<>Todavía no hay turnos. Cuando llega una solicitud crítica se avisa a Dirección y al abogado de turno vigente: crea un turno con «+ Nuevo turno».</>}
      barraAcciones={(t) => (
        <button type="button" disabled={!t || t.terminado} onClick={() => { setPanel(true); setMensaje(null) }} className={BOTON_BARRA}>Quitar turno</button>
      )}
      panel={(t, ctx) => {
        if (!t || !panel) return null
        return (
          <PanelAccion
            titulo="Quitar turno"
            delicada
            etiquetaGuardar="Quitar turno"
            guardando={guardando}
            error={error}
            resumen={<>Se quitará el turno de {t.persona} ({TIPO[t.tipo] ?? t.tipo}, {formatoFechaHora(t.desde)} a {formatoFechaHora(t.hasta)}). Si hay una solicitud crítica durante ese horario, esa persona ya no recibirá el aviso.</>}
            onCancelar={() => setPanel(false)}
            onGuardar={async () => {
              setGuardando(true)
              setError(null)
              try {
                const res = await fetch('/api/admin/crm/turnos', {
                  method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turno_id: t.id }),
                })
                const cuerpo = await res.json().catch(() => ({}))
                if (!res.ok) {
                  setError(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo quitar el turno.')
                  return
                }
                setPanel(false)
                setMensaje({ tipo: 'exito', texto: 'Turno quitado.' })
                ctx.limpiarSeleccion()
                ctx.recargar()
              } catch {
                setError('No se pudo conectar. Inténtalo de nuevo.')
              } finally {
                setGuardando(false)
              }
            }}
          />
        )
      }}
    />
  )
}
