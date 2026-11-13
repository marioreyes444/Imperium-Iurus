'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PanelAccion from '@/components/crm/PanelAccion'
import Franja from '@/components/crm/Franja'
import { BOTON_BARRA, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

export type MiembroVista = {
  id: string
  personal_id: string
  nombre: string
  rol: string
  rol_etiqueta: string
  estado: string
  estado_etiqueta: string
  funciones: string | null
  carga: number | null
  capacidad: number | null
  supera_capacidad: boolean
  motivo_supera_capacidad: string | null
  motivo_rechazo: string | null
}

type Props = {
  solicitudId: string
  codigo: string
  /** Revisión de conflictos del caso (texto ya traducido) y su valor. */
  conflicto: { valor: string; etiqueta: string }
  /** El caso admite asignar equipo (encargo aceptado). */
  admiteEquipo: boolean
  /** El caso admite reasignar el titular (asignado, en curso o en espera). */
  admiteReasignar: boolean
  puedeConflicto: boolean
  puedeProponer: boolean
  puedeAprobar: boolean
  puedeFinalizar: boolean
  puedeReasignar: boolean
  soloLectura: boolean
  miembros: MiembroVista[]
  motivosReasignacion: { valor: string; etiqueta: string }[]
}

type Panel =
  | { tipo: 'conflicto' }
  | { tipo: 'aprobar'; miembro: MiembroVista }
  | { tipo: 'finalizar'; miembro: MiembroVista }
  | { tipo: 'reasignar'; nuevo?: MiembroVista }
  | null

type Candidato = { id: string; nombres: string; apellidos: string }

const ESTADOS_ABIERTOS = new Set(['propuesto', 'pendiente_confirmacion', 'activo', 'en_reserva'])

export default function EquipoPanel(p: Props) {
  const router = useRouter()
  const [panel, setPanel] = useState<Panel>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [mensaje, setMensaje] = useState<string | null>(null)

  // Campos de los paneles
  const [resultado, setResultado] = useState('sin_conflicto')
  const [detalle, setDetalle] = useState('')
  const [motivo, setMotivo] = useState('')
  const [nuevoId, setNuevoId] = useState('')
  const [motivoReasignacion, setMotivoReasignacion] = useState('')
  const [entrega, setEntrega] = useState(false)
  // R-26: la base respondió que la persona está en su límite; se pide el motivo y se reintenta.
  const [pideCapacidad, setPideCapacidad] = useState(false)
  const [motivoCapacidad, setMotivoCapacidad] = useState('')
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null)

  function abrir(nuevo: Panel) {
    setMensaje(null); setError(null); setCampos({}); setPideCapacidad(false); setMotivoCapacidad('')
    setMotivo(''); setDetalle(''); setNuevoId(nuevo?.tipo === 'reasignar' ? (nuevo.nuevo?.personal_id ?? '') : '')
    setMotivoReasignacion(''); setEntrega(false)
    setPanel(nuevo)
  }
  const cerrar = () => { setPanel(null); setError(null); setCampos({}) }

  // Para reasignar: abogados activos entre los que elegir.
  useEffect(() => {
    if (panel?.tipo !== 'reasignar' || candidatos) return
    let vigente = true
    ;(async () => {
      try {
        const res = await fetch('/api/admin/crm/personal?abogados=true&limite=50', { cache: 'no-store' })
        const cuerpo = await res.json().catch(() => ({}))
        if (vigente) setCandidatos(res.ok ? (cuerpo.items as Candidato[]) : [])
      } catch {
        if (vigente) setCandidatos([])
      }
    })()
    return () => { vigente = false }
  }, [panel, candidatos])

  async function enviar(url: string, cuerpo: unknown, texto: string) {
    setGuardando(true); setError(null); setCampos({})
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
      const datos = await res.json().catch(() => ({}))
      if (!res.ok) {
        // R-26: se pide el motivo para superar la capacidad y se reintenta con el mismo botón.
        if (datos.codigo === 'R-26') {
          setPideCapacidad(true)
          setError('La persona está en su límite de capacidad. Para continuar, indica el motivo de la autorización.')
          return
        }
        if (datos.campos && typeof datos.campos === 'object') setCampos(datos.campos as Record<string, string>)
        setError(typeof datos.error === 'string' ? datos.error : 'No se pudo completar la acción.')
        if (res.status === 409) router.refresh()
        return
      }
      setMensaje(texto); cerrar(); router.refresh()
    } catch {
      setError('No se pudo conectar con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  const capacidadCampos = pideCapacidad && (
    <div>
      <label htmlFor="eq-capacidad" className={CLASE_ETIQUETA}>Motivo para superar la capacidad</label>
      <textarea
        id="eq-capacidad" rows={2} maxLength={500} value={motivoCapacidad}
        onChange={(e) => setMotivoCapacidad(e.target.value)} className={CLASE_INPUT}
        aria-invalid={campos.motivo_capacidad ? true : undefined}
      />
      {campos.motivo_capacidad && <p className="mt-1 font-montserrat text-xs text-red-400">{campos.motivo_capacidad}</p>}
    </div>
  )
  const extraCapacidad = pideCapacidad ? { supera_capacidad: true, motivo_capacidad: motivoCapacidad } : {}

  const hayRetiro = (m: MiembroVista) => p.puedeFinalizar && !p.soloLectura && ESTADOS_ABIERTOS.has(m.estado) && (m.rol !== 'titular' || m.estado === 'propuesto')

  return (
    <div className="space-y-5">
      {mensaje && <Franja tipo="exito">{mensaje}</Franja>}
      {p.soloLectura && <Franja tipo="info">Caso cerrado — solo lectura.</Franja>}

      {/* Pasos de la asignación */}
      <section aria-labelledby="eq-pasos" className="border border-border bg-card-bg px-5 py-4">
        <h2 id="eq-pasos" className="font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80">Asignación en tres pasos</h2>
        <ol className="mt-3 space-y-1.5 font-montserrat text-xs leading-relaxed text-text-muted">
          <li><span className="text-gold">1.</span> Revisión de conflictos: <span className="text-text-light">{p.conflicto.etiqueta}</span>. Debe ser «Sin conflicto» para aceptar el encargo.</li>
          <li><span className="text-gold">2.</span> Dirección acepta el encargo y aprueba al equipo propuesto.</li>
          <li><span className="text-gold">3.</span> La persona asignada confirma desde «Mis asignaciones»; el titular lleva el caso a «En curso».</li>
        </ol>
        {!p.soloLectura && (
          <div className="mt-4 flex flex-wrap gap-3">
            {p.puedeConflicto && <button type="button" onClick={() => abrir({ tipo: 'conflicto' })} className={BOTON_BARRA}>Registrar revisión de conflictos</button>}
            {p.puedeProponer && p.admiteEquipo && (
              <Link href={`/admin/crm/solicitudes/${p.solicitudId}/equipo/proponer`} className={BOTON_BARRA}>Proponer equipo</Link>
            )}
            {p.puedeReasignar && p.admiteReasignar && <button type="button" onClick={() => abrir({ tipo: 'reasignar' })} className={BOTON_BARRA}>Reasignar titular</button>}
          </div>
        )}
        {p.puedeProponer && !p.admiteEquipo && !p.soloLectura && (
          <p className="mt-3 font-montserrat text-[11px] text-text-muted">El equipo se propone cuando Dirección acepta el encargo.</p>
        )}
      </section>

      {panel?.tipo === 'conflicto' && (
        <PanelAccion
          titulo="Revisión de conflictos de interés" delicada guardando={guardando} error={error}
          resumen="Con «Con conflicto» el caso solo podrá descartarse. Con «Sin conflicto» podrá aceptarse y asignarse."
          onGuardar={() => enviar(`/api/admin/crm/solicitudes/${p.solicitudId}/conflicto`, { resultado, detalle }, 'Revisión de conflictos registrada.')}
          onCancelar={cerrar}
        >
          <div>
            <label htmlFor="eq-resultado" className={CLASE_ETIQUETA}>Resultado</label>
            <select id="eq-resultado" value={resultado} onChange={(e) => setResultado(e.target.value)} className={CLASE_INPUT}>
              <option value="sin_conflicto">Sin conflicto</option>
              <option value="con_conflicto">Con conflicto</option>
            </select>
          </div>
          <div>
            <label htmlFor="eq-detalle" className={CLASE_ETIQUETA}>Detalle de la revisión</label>
            <textarea id="eq-detalle" rows={3} maxLength={2000} value={detalle} onChange={(e) => setDetalle(e.target.value)} className={CLASE_INPUT}
              aria-invalid={campos.detalle ? true : undefined} />
            {campos.detalle && <p className="mt-1 font-montserrat text-xs text-red-400">{campos.detalle}</p>}
          </div>
        </PanelAccion>
      )}

      {/* Equipo */}
      <section aria-labelledby="eq-equipo">
        <h2 id="eq-equipo" className="font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80">Equipo del caso</h2>
        {p.miembros.length === 0 ? (
          <p className="mt-3 font-montserrat text-xs text-text-muted">
            Todavía no hay nadie propuesto. {p.puedeProponer ? 'Cuando el encargo esté aceptado, usa «Proponer equipo».' : 'Coordinación o Dirección proponen el equipo.'}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border border border-border bg-card-bg">
            {p.miembros.map((m) => {
              const enLimite = m.capacidad !== null && m.carga !== null && m.carga >= m.capacidad
              const abierto = ESTADOS_ABIERTOS.has(m.estado)
              return (
                <li key={m.id} className={`px-5 py-3 font-montserrat text-xs ${abierto ? '' : 'opacity-60'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-text-light">{m.nombre} <span className="text-text-muted">· {m.rol_etiqueta}</span></p>
                      <p className="mt-0.5 text-text-muted">
                        {m.estado_etiqueta}
                        {m.carga !== null && <> · Carga {m.carga}{m.capacidad !== null ? ` de ${m.capacidad}` : ' (sin límite)'}</>}
                        {enLimite && abierto && <span className="text-gold"> · en su límite</span>}
                      </p>
                      {m.funciones && <p className="mt-0.5 text-text-muted">Funciones: {m.funciones}</p>}
                      {m.supera_capacidad && <p className="mt-0.5 text-gold">Autorizado sobre su capacidad: {m.motivo_supera_capacidad}</p>}
                      {m.motivo_rechazo && <p className="mt-0.5 text-text-muted">Motivo del rechazo: {m.motivo_rechazo}</p>}
                    </div>
                    {!p.soloLectura && (
                      <div className="flex flex-wrap gap-2">
                        {p.puedeAprobar && m.estado === 'propuesto' && <button type="button" onClick={() => abrir({ tipo: 'aprobar', miembro: m })} className={BOTON_BARRA}>Aprobar</button>}
                        {p.puedeReasignar && p.admiteReasignar && m.estado === 'en_reserva' && (
                          <button type="button" onClick={() => abrir({ tipo: 'reasignar', nuevo: m })} className={BOTON_BARRA}>Activar como titular</button>
                        )}
                        {hayRetiro(m) && <button type="button" onClick={() => abrir({ tipo: 'finalizar', miembro: m })} className={BOTON_BARRA}>Retirar</button>}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {panel?.tipo === 'aprobar' && (
        <PanelAccion
          titulo={`Aprobar a ${panel.miembro.nombre}`} etiquetaGuardar={pideCapacidad ? 'Autorizar y aprobar' : 'Aprobar'} guardando={guardando} error={error}
          resumen={panel.miembro.rol === 'suplente'
            ? 'El suplente queda en reserva: no verá el caso hasta que se le active como titular.'
            : 'La persona recibirá el aviso en su panel y deberá confirmar la asignación.'}
          onGuardar={() => enviar(`/api/admin/crm/equipo/${panel.miembro.id}/aprobar`, extraCapacidad, 'Asignación aprobada. Queda pendiente de confirmación.')}
          onCancelar={cerrar}
        >
          {capacidadCampos}
        </PanelAccion>
      )}

      {panel?.tipo === 'finalizar' && (
        <PanelAccion
          titulo={`Retirar a ${panel.miembro.nombre}`} delicada etiquetaGuardar="Retirar" guardando={guardando} error={error}
          resumen="La persona deja de figurar en el equipo. El motivo queda en el historial del caso."
          onGuardar={() => enviar(`/api/admin/crm/equipo/${panel.miembro.id}/finalizar`, { motivo }, 'Persona retirada del equipo.')}
          onCancelar={cerrar}
        >
          <div>
            <label htmlFor="eq-motivo" className={CLASE_ETIQUETA}>Motivo</label>
            <textarea id="eq-motivo" rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CLASE_INPUT}
              aria-invalid={campos.motivo ? true : undefined} />
            {campos.motivo && <p className="mt-1 font-montserrat text-xs text-red-400">{campos.motivo}</p>}
          </div>
        </PanelAccion>
      )}

      {panel?.tipo === 'reasignar' && (
        <PanelAccion
          titulo={panel.nuevo ? `Activar a ${panel.nuevo.nombre} como titular` : 'Reasignar titular'} delicada
          etiquetaGuardar={pideCapacidad ? 'Autorizar y reasignar' : 'Reasignar'} guardando={guardando} error={error}
          resumen="El titular actual deja el caso y la nueva persona queda como titular activa de inmediato. Si el motivo es un conflicto descubierto con el caso en curso, elige «Conflicto de interés»."
          onGuardar={() => enviar(
            `/api/admin/crm/solicitudes/${p.solicitudId}/reasignar`,
            { nuevo_titular_id: nuevoId, motivo: motivoReasignacion, detalle: detalle || undefined, entrega_documentada: entrega, ...extraCapacidad },
            'Titular reasignado.',
          )}
          onCancelar={cerrar}
        >
          <div>
            <label htmlFor="eq-nuevo" className={CLASE_ETIQUETA}>Nuevo titular</label>
            <select id="eq-nuevo" value={nuevoId} onChange={(e) => setNuevoId(e.target.value)} className={CLASE_INPUT}
              disabled={!!panel.nuevo} aria-invalid={campos.nuevo_titular_id ? true : undefined}>
              <option value="">{candidatos === null ? 'Cargando…' : 'Elige una persona'}</option>
              {panel.nuevo && <option value={panel.nuevo.personal_id}>{panel.nuevo.nombre}</option>}
              {(candidatos ?? []).filter((c) => c.id !== panel.nuevo?.personal_id).map((c) => (
                <option key={c.id} value={c.id}>{c.nombres} {c.apellidos}</option>
              ))}
            </select>
            {campos.nuevo_titular_id && <p className="mt-1 font-montserrat text-xs text-red-400">{campos.nuevo_titular_id}</p>}
          </div>
          <div>
            <label htmlFor="eq-motivo-re" className={CLASE_ETIQUETA}>Motivo</label>
            <select id="eq-motivo-re" value={motivoReasignacion} onChange={(e) => setMotivoReasignacion(e.target.value)} className={CLASE_INPUT}
              aria-invalid={campos.motivo ? true : undefined}>
              <option value="">Elige un motivo</option>
              {p.motivosReasignacion.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
            </select>
            {campos.motivo && <p className="mt-1 font-montserrat text-xs text-red-400">{campos.motivo}</p>}
          </div>
          <div>
            <label htmlFor="eq-detalle-re" className={CLASE_ETIQUETA}>Detalle (opcional)</label>
            <textarea id="eq-detalle-re" rows={2} maxLength={1000} value={detalle} onChange={(e) => setDetalle(e.target.value)} className={CLASE_INPUT} />
          </div>
          <label className="flex items-center gap-2 font-montserrat text-xs text-text-light">
            <input type="checkbox" checked={entrega} onChange={(e) => setEntrega(e.target.checked)} className="focus-gold" />
            La entrega del caso quedó documentada
          </label>
          {capacidadCampos}
        </PanelAccion>
      )}
    </div>
  )
}
