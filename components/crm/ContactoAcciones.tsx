'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PanelAccion from '@/components/crm/PanelAccion'
import Franja from '@/components/crm/Franja'
import BuscadorContacto, { type ContactoElegido } from '@/components/crm/BuscadorContacto'
import { BOTON_BARRA, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

type Props = {
  contactoId: string
  tipo: 'persona' | 'empresa'
  updatedAt: string
  reservada: boolean
  noContinua: boolean
  permisos: {
    editar: boolean
    marcar_reserva: boolean
    quitar_reserva: boolean
    etapa_manual: boolean
    vincular: boolean
    marcar_duplicado: boolean
    crear_solicitud: boolean
  }
  vinculados: { id: string; nombre: string; cargo: string | null; es_representante_legal: boolean; como: 'persona' | 'empresa' }[]
  aviso?: 'creado' | 'editado'
}

type Panel = 'reserva' | 'no_continua' | 'reanudar' | 'duplicado' | 'vincular' | null

const AVISOS = { creado: 'Contacto creado.', editado: 'Cambios guardados.' } as const

export default function ContactoAcciones({ contactoId, tipo, updatedAt, reservada, noContinua, permisos, vinculados, aviso }: Props) {
  const router = useRouter()
  const [panel, setPanel] = useState<Panel>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCampo, setErrorCampo] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(aviso ? { tipo: 'exito', texto: AVISOS[aviso] } : null)

  const [motivo, setMotivo] = useState('')
  const [otra, setOtra] = useState<ContactoElegido | null>(null)
  const [coincidencia, setCoincidencia] = useState('correo')
  const [cargo, setCargo] = useState('')
  const [representante, setRepresentante] = useState(false)

  function abrir(p: Panel) {
    setPanel(p); setError(null); setErrorCampo(null); setMotivo(''); setOtra(null); setCargo(''); setRepresentante(false); setMensaje(null)
  }
  function cerrar() { setPanel(null); setError(null); setErrorCampo(null) }

  async function llamar(url: string, metodo: string, cuerpo: unknown, textoExito: string) {
    setGuardando(true); setError(null); setErrorCampo(null)
    try {
      const res = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
      const datos = await res.json().catch(() => ({}))
      if (!res.ok) {
        const campo = datos.campos && Object.values(datos.campos as Record<string, string>)[0]
        if (campo) setErrorCampo(campo)
        else setError(typeof datos.error === 'string' ? datos.error : 'No se pudo completar la acción.')
        if (res.status === 409) router.refresh()
        return false
      }
      setMensaje({ tipo: 'exito', texto: textoExito })
      cerrar()
      router.refresh()
      return true
    } catch {
      setError('No se pudo conectar con el servidor.')
      return false
    } finally {
      setGuardando(false)
    }
  }

  const patch = (cuerpo: Record<string, unknown>, texto: string) =>
    llamar(`/api/admin/crm/contactos/${contactoId}`, 'PATCH', { updated_at: updatedAt, ...cuerpo }, texto)

  const puedeCambiarReserva = reservada ? permisos.quitar_reserva : permisos.marcar_reserva
  const hayAcciones = permisos.editar || permisos.crear_solicitud || puedeCambiarReserva || permisos.etapa_manual || permisos.vincular || permisos.marcar_duplicado

  return (
    <div className="space-y-4">
      {mensaje && <Franja tipo={mensaje.tipo}>{mensaje.texto}</Franja>}

      {hayAcciones && (
        <div className="flex flex-wrap items-center gap-3 border border-border bg-card-bg px-4 py-2.5">
          {permisos.editar && <Link href={`/admin/crm/contactos/${contactoId}/editar`} className={BOTON_BARRA}>Editar</Link>}
          {permisos.crear_solicitud && <Link href={`/admin/crm/solicitudes/nueva?contacto=${contactoId}`} className={BOTON_BARRA}>Nueva solicitud</Link>}
          {puedeCambiarReserva && (
            <button type="button" onClick={() => abrir('reserva')} className={BOTON_BARRA}>
              {reservada ? 'Quitar reserva reforzada' : 'Marcar reserva reforzada'}
            </button>
          )}
          {permisos.etapa_manual && (noContinua
            ? <button type="button" onClick={() => abrir('reanudar')} className={BOTON_BARRA}>Reanudar relación</button>
            : <button type="button" onClick={() => abrir('no_continua')} className={BOTON_BARRA}>Marcar «no continúa»</button>)}
          {permisos.vincular && (
            <button type="button" onClick={() => abrir('vincular')} className={BOTON_BARRA}>
              {tipo === 'empresa' ? 'Vincular persona de contacto' : 'Vincular con una empresa'}
            </button>
          )}
          {permisos.marcar_duplicado && <button type="button" onClick={() => abrir('duplicado')} className={BOTON_BARRA}>Marcar posible duplicado</button>}
        </div>
      )}

      {panel === 'reserva' && (
        <PanelAccion
          titulo={reservada ? 'Quitar reserva reforzada' : 'Marcar reserva reforzada'}
          delicada guardando={guardando} error={error}
          etiquetaGuardar={reservada ? 'Quitar reserva' : 'Marcar reserva'}
          resumen={reservada
            ? 'La ficha dejará de estar restringida: la verán quienes ven los contactos normales.'
            : 'Solo la verán Dirección y quienes estén activos en el equipo de algún caso de este contacto. Dejará de aparecer en búsquedas, listados y conteos de los demás.'}
          onGuardar={() => patch({ reserva_reforzada: !reservada }, reservada ? 'Reserva reforzada retirada.' : 'Reserva reforzada marcada.')}
          onCancelar={cerrar}
        />
      )}

      {panel === 'no_continua' && (
        <PanelAccion
          titulo="Marcar «no continúa»" delicada guardando={guardando} error={error} etiquetaGuardar="Marcar"
          resumen="La relación queda detenida y no se recalcula sola. Volverá a activarse si llega una solicitud nueva."
          onGuardar={() => patch({ etapa_manual: 'no_continua', motivo_no_continua: motivo }, 'Relación marcada como «no continúa».')}
          onCancelar={cerrar}
        >
          <div>
            <label htmlFor="ct-motivo" className={CLASE_ETIQUETA}>Motivo (obligatorio)</label>
            <textarea id="ct-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} className={CLASE_INPUT}
              aria-invalid={errorCampo ? true : undefined} aria-describedby={errorCampo ? 'ct-motivo-error' : undefined} />
            {errorCampo && <p id="ct-motivo-error" className="mt-1 font-montserrat text-xs text-red-400">{errorCampo}</p>}
          </div>
        </PanelAccion>
      )}

      {panel === 'reanudar' && (
        <PanelAccion
          titulo="Reanudar relación" guardando={guardando} error={error} etiquetaGuardar="Reanudar"
          resumen="La etapa se recalcula a partir de las solicitudes del contacto."
          onGuardar={() => patch({ etapa_manual: 'reanudar' }, 'Relación reanudada.')}
          onCancelar={cerrar}
        />
      )}

      {panel === 'duplicado' && (
        <PanelAccion
          titulo="Marcar posible duplicado" guardando={guardando} error={error} etiquetaGuardar="Marcar"
          resumen="Elige la otra ficha. Dirección o coordinación decidirá si se fusionan; nada se fusiona automáticamente."
          onGuardar={() => otra
            ? llamar('/api/admin/crm/duplicados', 'POST', { contacto_a: contactoId, contacto_b: otra.id, coincidencia }, 'Marcado como posible duplicado.')
            : Promise.resolve(setError('Elige la otra ficha.'))}
          onCancelar={cerrar}
        >
          {otra
            ? <p className="font-montserrat text-xs text-text-light">Otra ficha: <span className="text-gold">{otra.nombre}</span> <button type="button" onClick={() => setOtra(null)} className="focus-gold ml-2 text-text-muted underline">cambiar</button></p>
            : <BuscadorContacto etiqueta="Buscar la otra ficha" excluirId={contactoId} onElegir={setOtra} />}
          <div>
            <label htmlFor="ct-coincidencia" className={CLASE_ETIQUETA}>Motivo de la sospecha</label>
            <select id="ct-coincidencia" value={coincidencia} onChange={(e) => setCoincidencia(e.target.value)} className={CLASE_INPUT}>
              <option value="correo">Mismo correo</option>
              <option value="telefono">Mismo teléfono</option>
              <option value="nombre">Mismo nombre</option>
            </select>
          </div>
        </PanelAccion>
      )}

      {panel === 'vincular' && (
        <PanelAccion
          titulo={tipo === 'empresa' ? 'Vincular persona de contacto' : 'Vincular con una empresa'}
          guardando={guardando} error={error} etiquetaGuardar="Vincular"
          onGuardar={() => otra
            ? llamar(`/api/admin/crm/contactos/${contactoId}/vinculos`, 'POST', {
                empresa_id: tipo === 'empresa' ? contactoId : otra.id,
                persona_id: tipo === 'empresa' ? otra.id : contactoId,
                cargo, es_representante_legal: representante,
              }, 'Vínculo creado.')
            : Promise.resolve(setError('Elige la ficha a vincular.'))}
          onCancelar={cerrar}
        >
          {otra
            ? <p className="font-montserrat text-xs text-text-light">Ficha: <span className="text-gold">{otra.nombre}</span> <button type="button" onClick={() => setOtra(null)} className="focus-gold ml-2 text-text-muted underline">cambiar</button></p>
            : <BuscadorContacto etiqueta={tipo === 'empresa' ? 'Buscar la persona' : 'Buscar la empresa'} tipo={tipo === 'empresa' ? 'persona' : 'empresa'} excluirId={contactoId} onElegir={setOtra} />}
          <div>
            <label htmlFor="ct-cargo" className={CLASE_ETIQUETA}>Cargo (opcional)</label>
            <input id="ct-cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} maxLength={120} className={CLASE_INPUT} />
          </div>
          <label className="flex items-center gap-3 font-montserrat text-xs text-text-light">
            <input type="checkbox" checked={representante} onChange={(e) => setRepresentante(e.target.checked)} className="focus-gold h-4 w-4 accent-[#C9A646]" />
            Es representante legal
          </label>
        </PanelAccion>
      )}

      {vinculados.length > 0 && (
        <section aria-labelledby="ct-vinculos">
          <h2 id="ct-vinculos" className="font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80">
            {tipo === 'empresa' ? 'Personas de contacto' : 'Empresas vinculadas'}
          </h2>
          <ul className="mt-3 divide-y divide-border border border-border bg-card-bg">
            {vinculados.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-3 font-montserrat text-xs">
                <Link href={`/admin/crm/contactos/${v.id}`} className="focus-gold min-w-0 flex-1 truncate text-text-light hover:text-gold">{v.nombre}</Link>
                <span className="shrink-0 text-text-muted">{[v.cargo, v.es_representante_legal ? 'Representante legal' : null].filter(Boolean).join(' · ')}</span>
                {permisos.vincular && (
                  <button
                    type="button"
                    disabled={guardando}
                    onClick={() => llamar(`/api/admin/crm/contactos/${contactoId}/vinculos`, 'DELETE', {
                      empresa_id: tipo === 'empresa' ? contactoId : v.id,
                      persona_id: tipo === 'empresa' ? v.id : contactoId,
                    }, 'Vínculo quitado.')}
                    className="focus-gold shrink-0 text-text-muted underline hover:text-red-400"
                  >
                    Quitar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
