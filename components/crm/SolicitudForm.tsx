'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Franja from '@/components/crm/Franja'
import BuscadorContacto, { type ContactoElegido } from '@/components/crm/BuscadorContacto'
import ContactoForm from '@/components/crm/ContactoForm'
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

export type CatalogoForm = {
  areas: { id: string; nombre: string }[]
  servicios: { id: string; area_id: string; nombre: string }[]
}

export type SolicitudInicial = {
  id: string
  codigo: string
  descripcion: string
  objetivo_cliente: string | null
  modalidad: string | null
  urgencia: string
  area_principal_id: string | null
  servicio_id: string | null
  reserva_reforzada: boolean
  updated_at: string
}

type Props = {
  modo: 'nueva' | 'editar'
  catalogo: CatalogoForm
  urgencias: { valor: string; etiqueta: string }[]
  /** Canales que el personal puede elegir a mano. */
  canales: { valor: string; etiqueta: string }[]
  puedeMarcarReserva: boolean
  puedeQuitarReserva: boolean
  contactoInicial?: { id: string; nombre: string } | null
  inicial?: SolicitudInicial
}

type Errores = Record<string, string>

const MODALIDADES = [['judicial', 'Judicial'], ['administrativa', 'Administrativa'], ['extrajudicial', 'Extrajudicial'], ['notarial', 'Notarial']] as const

function Campo({ id, etiqueta, error, children }: { id: string; etiqueta: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={CLASE_ETIQUETA}>{etiqueta}</label>
      {children}
      {error && <p id={`${id}-error`} className="mt-1 font-montserrat text-xs text-red-400">{error}</p>}
    </div>
  )
}

export default function SolicitudForm({
  modo, catalogo, urgencias, canales, puedeMarcarReserva, puedeQuitarReserva, contactoInicial, inicial,
}: Props) {
  const router = useRouter()
  const editar = modo === 'editar'

  // Paso 1 (solo «nueva»): buscar el contacto o crearlo en la misma página.
  const [contacto, setContacto] = useState<{ id: string; nombre: string } | null>(contactoInicial ?? null)
  const [paso, setPaso] = useState<1 | 2>(editar || contactoInicial ? 2 : 1)
  const [creandoContacto, setCreandoContacto] = useState(false)
  const [empresa, setEmpresa] = useState<ContactoElegido | null>(null)

  const [v, setV] = useState({
    canal_origen: 'llamada',
    descripcion: inicial?.descripcion ?? '',
    objetivo_cliente: inicial?.objetivo_cliente ?? '',
    modalidad: inicial?.modalidad ?? '',
    urgencia: inicial?.urgencia ?? 'ordinaria',
    area_principal_id: inicial?.area_principal_id ?? '',
    servicio_id: inicial?.servicio_id ?? '',
  })
  const [reservada, setReservada] = useState(inicial?.reserva_reforzada ?? false)
  const set = (c: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [c]: e.target.value }))

  const [errores, setErrores] = useState<Errores>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const id = (c: string) => `sol-${c}`
  const ariaError = (c: string) => (errores[c] ? { 'aria-invalid': true as const, 'aria-describedby': `${id(c)}-error` } : {})
  const hayCatalogo = catalogo.areas.length > 0
  const serviciosDelArea = catalogo.servicios.filter((s) => s.area_id === v.area_principal_id)
  const puedeReservar = editar ? (inicial?.reserva_reforzada ? puedeQuitarReserva : puedeMarcarReserva) : puedeMarcarReserva

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErrores({}); setErrorGeneral(null)
    if (!editar && !contacto) { setErrorGeneral('Elige primero el contacto.'); return }
    setGuardando(true)
    try {
      let url = '/api/admin/crm/solicitudes'
      let metodo = 'POST'
      let cuerpo: Record<string, unknown>

      if (editar && inicial) {
        url = `${url}/${inicial.id}`
        metodo = 'PATCH'
        cuerpo = { updated_at: inicial.updated_at }
        if (v.descripcion.trim() !== inicial.descripcion) cuerpo.descripcion = v.descripcion
        if (v.objetivo_cliente.trim() !== (inicial.objetivo_cliente ?? '')) cuerpo.objetivo_cliente = v.objetivo_cliente
        if (v.modalidad !== (inicial.modalidad ?? '')) cuerpo.modalidad = v.modalidad
        if (v.urgencia !== inicial.urgencia) cuerpo.urgencia = v.urgencia
        if (v.area_principal_id !== (inicial.area_principal_id ?? '')) cuerpo.area_principal_id = v.area_principal_id
        if (v.servicio_id !== (inicial.servicio_id ?? '')) cuerpo.servicio_id = v.servicio_id
        if (puedeReservar && reservada !== inicial.reserva_reforzada) cuerpo.reserva_reforzada = reservada
      } else {
        cuerpo = {
          contacto_id: contacto?.id, empresa_id: empresa?.id, ...v,
          ...(puedeMarcarReserva && reservada ? { reserva_reforzada: true } : {}),
        }
      }

      const res = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
      const datos = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (datos.campos && typeof datos.campos === 'object') {
          const { _: general, ...porCampo } = datos.campos as Errores
          setErrores(porCampo)
          setErrorGeneral(general ?? (Object.keys(porCampo).length ? null : datos.error ?? null))
        } else {
          setErrorGeneral(typeof datos.error === 'string' ? datos.error : 'No se pudo guardar.')
        }
        return
      }
      const destino = editar && inicial ? inicial.id : datos.solicitud.id
      router.push(`/admin/crm/solicitudes/${destino}?aviso=${editar ? 'editada' : 'creada'}`)
      router.refresh()
    } catch {
      setErrorGeneral('No se pudo conectar con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 pb-16 pt-8">
      <div className="border-b border-border pb-5">
        <h1 className="font-cinzel text-2xl font-bold uppercase tracking-wider text-gold">
          {editar ? `Editar ${inicial?.codigo ?? 'solicitud'}` : 'Nueva solicitud'}
        </h1>
        {!editar && <p className="mt-2 font-montserrat text-xs text-text-muted">Paso {paso} de 2 · {paso === 1 ? 'Contacto' : 'Datos del pedido'}</p>}
      </div>

      {/* ── Paso 1: contacto ─────────────────────────────────────────────── */}
      {!editar && paso === 1 && (
        <section aria-label="Contacto" className="space-y-5">
          {!creandoContacto ? (
            <>
              <BuscadorContacto
                etiqueta="Buscar el contacto"
                onElegir={(c) => { setContacto({ id: c.id, nombre: c.nombre }); setPaso(2) }}
              />
              <button type="button" onClick={() => setCreandoContacto(true)} className={BOTON_SECUNDARIO}>
                No está: crear un contacto nuevo
              </button>
            </>
          ) : (
            <div className="space-y-4 border border-border bg-card-bg p-5">
              <p className="font-cinzel text-xs uppercase tracking-[0.2em] text-gold">Contacto nuevo</p>
              <ContactoForm
                modo="nuevo"
                onCreado={(c) => { setContacto(c); setCreandoContacto(false); setPaso(2) }}
              />
              <button type="button" onClick={() => setCreandoContacto(false)} className={BOTON_SECUNDARIO}>Volver a buscar</button>
            </div>
          )}
        </section>
      )}

      {/* ── Paso 2: datos del pedido ─────────────────────────────────────── */}
      {paso === 2 && (
        <form onSubmit={enviar} noValidate className="space-y-5">
          {errorGeneral && <Franja tipo="error">{errorGeneral}</Franja>}

          {!editar && contacto && (
            <p className="font-montserrat text-xs text-text-light">
              Contacto: <span className="text-gold">{contacto.nombre}</span>
              {!contactoInicial && (
                <button type="button" onClick={() => { setPaso(1); setContacto(null) }} className="focus-gold ml-3 text-text-muted underline">cambiar</button>
              )}
            </p>
          )}

          {!editar && (
            <Campo id={id('canal_origen')} etiqueta="Canal por el que llegó" error={errores.canal_origen}>
              <select id={id('canal_origen')} value={v.canal_origen} onChange={set('canal_origen')} className={CLASE_INPUT} {...ariaError('canal_origen')}>
                {canales.map((c) => <option key={c.valor} value={c.valor}>{c.etiqueta}</option>)}
              </select>
            </Campo>
          )}

          <Campo id={id('descripcion')} etiqueta="Descripción del pedido" error={errores.descripcion}>
            <textarea id={id('descripcion')} value={v.descripcion} onChange={set('descripcion')} rows={5} maxLength={5000} className={CLASE_INPUT} {...ariaError('descripcion')} />
          </Campo>
          <Campo id={id('objetivo_cliente')} etiqueta="Qué busca el cliente (opcional)" error={errores.objetivo_cliente}>
            <textarea id={id('objetivo_cliente')} value={v.objetivo_cliente} onChange={set('objetivo_cliente')} rows={2} maxLength={2000} className={CLASE_INPUT} {...ariaError('objetivo_cliente')} />
          </Campo>

          <div className="grid gap-5 sm:grid-cols-2">
            <Campo id={id('urgencia')} etiqueta="Urgencia" error={errores.urgencia}>
              <select id={id('urgencia')} value={v.urgencia} onChange={set('urgencia')} className={CLASE_INPUT} {...ariaError('urgencia')}>
                {urgencias.map((u) => <option key={u.valor} value={u.valor}>{u.etiqueta}</option>)}
              </select>
            </Campo>
            <Campo id={id('modalidad')} etiqueta="Modalidad (opcional)" error={errores.modalidad}>
              <select id={id('modalidad')} value={v.modalidad} onChange={set('modalidad')} className={CLASE_INPUT} {...ariaError('modalidad')}>
                <option value="">Sin definir</option>
                {MODALIDADES.map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}
              </select>
            </Campo>
          </div>

          {/* Área y servicio: listos para cuando el catálogo E5 tenga datos. */}
          <div className="grid gap-5 sm:grid-cols-2">
            <Campo id={id('area_principal_id')} etiqueta="Área (opcional)" error={errores.area_principal_id}>
              <select
                id={id('area_principal_id')} value={v.area_principal_id} disabled={!hayCatalogo}
                onChange={(e) => setV((p) => ({ ...p, area_principal_id: e.target.value, servicio_id: '' }))}
                className={CLASE_INPUT} {...ariaError('area_principal_id')}
              >
                <option value="">{hayCatalogo ? 'Sin definir' : 'Catálogo no disponible aún'}</option>
                {catalogo.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </Campo>
            <Campo id={id('servicio_id')} etiqueta="Servicio (opcional)" error={errores.servicio_id}>
              <select
                id={id('servicio_id')} value={v.servicio_id} onChange={set('servicio_id')}
                disabled={!hayCatalogo || !v.area_principal_id} className={CLASE_INPUT} {...ariaError('servicio_id')}
              >
                <option value="">{v.area_principal_id ? 'Sin definir' : 'Elige primero un área'}</option>
                {serviciosDelArea.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </Campo>
          </div>
          {!hayCatalogo && (
            <p className="font-montserrat text-[11px] leading-relaxed text-text-muted">
              El catálogo de áreas y servicios aún no está disponible en este entorno. Podrás calificar el área más adelante.
            </p>
          )}

          {!editar && (
            <div>
              {empresa ? (
                <p className="font-montserrat text-xs text-text-light">
                  Actúa en nombre de: <span className="text-gold">{empresa.nombre}</span>
                  <button type="button" onClick={() => setEmpresa(null)} className="focus-gold ml-3 text-text-muted underline">quitar</button>
                </p>
              ) : (
                <BuscadorContacto etiqueta="Empresa a la que representa (opcional)" tipo="empresa" onElegir={setEmpresa} />
              )}
              {errores.empresa_id && <p className="mt-1 font-montserrat text-xs text-red-400">{errores.empresa_id}</p>}
            </div>
          )}

          {puedeReservar && (
            <label className="flex items-start gap-3 font-montserrat text-xs leading-relaxed text-text-light">
              <input type="checkbox" checked={reservada} onChange={(e) => setReservada(e.target.checked)} className="focus-gold mt-0.5 h-4 w-4 accent-[#C9A646]" />
              <span>
                Reserva reforzada
                <span className="block text-text-muted">Solo la verán Dirección y quienes estén activos en el equipo del caso.</span>
              </span>
            </label>
          )}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={guardando} className={BOTON_PRIMARIO}>
              {guardando ? 'Guardando…' : editar ? 'Guardar cambios' : 'Registrar solicitud'}
            </button>
            <button type="button" onClick={() => router.back()} disabled={guardando} className={BOTON_SECUNDARIO}>Volver</button>
          </div>
        </form>
      )}
    </div>
  )
}
