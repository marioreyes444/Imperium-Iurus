'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Franja from '@/components/crm/Franja'
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

export type ContactoInicial = {
  id: string
  tipo: 'persona' | 'empresa'
  nombres: string | null
  apellidos: string | null
  ocupacion: string | null
  razon_social: string | null
  nombre_comercial: string | null
  sector: string | null
  tipo_identificacion: string | null
  identificacion: string | null
  telefono: string | null
  correo: string | null
  ciudad: string | null
  direccion: string | null
  preferencia_comunicacion: string | null
  como_nos_conocio: string | null
  notas_internas: string | null
  updated_at: string
}

type Props = {
  modo: 'nuevo' | 'editar'
  inicial?: ContactoInicial
  /** Marca el campo de apellidos cuando la ficha vino de un formulario web. */
  resaltarApellidos?: boolean
  /** Dentro de otra página (p. ej. «Nueva solicitud»): sin cabecera y, al crear, avisa en vez de navegar. */
  onCreado?: (contacto: { id: string; nombre: string }) => void
}

type Coincidencia = { id: string; nombre: string; coincidencia: 'identificacion' | 'telefono' | 'correo'; etapa_relacion: string }
type Errores = Record<string, string>

const TIPOS_ID_PERSONA = [['cedula', 'Cédula'], ['pasaporte', 'Pasaporte'], ['ruc', 'RUC'], ['extranjera', 'Identificación extranjera']] as const
const TIPOS_ID_EMPRESA = [['ruc', 'RUC'], ['extranjera', 'Identificación extranjera']] as const
const ETIQUETA_COINCIDENCIA = { identificacion: 'misma identificación', telefono: 'mismo teléfono', correo: 'mismo correo' } as const

function Campo({ id, etiqueta, error, ayuda, children }: { id: string; etiqueta: string; error?: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={CLASE_ETIQUETA}>{etiqueta}</label>
      {children}
      {ayuda && !error && <p className="mt-1 font-montserrat text-[11px] text-text-muted">{ayuda}</p>}
      {error && <p id={`${id}-error`} className="mt-1 font-montserrat text-xs text-red-400">{error}</p>}
    </div>
  )
}

export default function ContactoForm({ modo, inicial, resaltarApellidos = false, onCreado }: Props) {
  const router = useRouter()
  const editar = modo === 'editar'

  const [tipo, setTipo] = useState<'persona' | 'empresa'>(inicial?.tipo ?? 'persona')
  const [v, setV] = useState({
    nombres: inicial?.nombres ?? '', apellidos: inicial?.apellidos ?? '', ocupacion: inicial?.ocupacion ?? '',
    razon_social: inicial?.razon_social ?? '', nombre_comercial: inicial?.nombre_comercial ?? '', sector: inicial?.sector ?? '',
    tipo_identificacion: inicial?.tipo_identificacion ?? '', identificacion: inicial?.identificacion ?? '',
    telefono: inicial?.telefono ?? '', correo: inicial?.correo ?? '', ciudad: inicial?.ciudad ?? '', direccion: inicial?.direccion ?? '',
    preferencia_comunicacion: inicial?.preferencia_comunicacion ?? '', como_nos_conocio: inicial?.como_nos_conocio ?? '',
    notas_internas: inicial?.notas_internas ?? '',
  })
  const set = (c: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [c]: e.target.value }))

  const [errores, setErrores] = useState<Errores>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [coincidencias, setCoincidencias] = useState<Coincidencia[] | null>(null)

  const id = (c: string) => `ct-${c}`
  const ariaError = (c: string) => (errores[c] ? { 'aria-invalid': true as const, 'aria-describedby': `${id(c)}-error` } : {})

  function mostrarError(datos: { error?: string; campos?: Errores }) {
    if (datos.campos) {
      const { _: general, ...porCampo } = datos.campos
      setErrores(porCampo)
      setErrorGeneral(general ?? (Object.keys(porCampo).length ? null : datos.error ?? null))
    } else {
      setErrorGeneral(typeof datos.error === 'string' ? datos.error : 'No se pudo guardar.')
    }
  }

  async function enviar(confirmado: boolean) {
    setErrores({})
    setErrorGeneral(null)
    setGuardando(true)
    try {
      if (editar && inicial) {
        // Solo se envía lo que cambió.
        const cuerpo: Record<string, unknown> = { updated_at: inicial.updated_at }
        for (const [k, valor] of Object.entries(v)) {
          const previo = (inicial as unknown as Record<string, string | null>)[k] ?? ''
          if (valor.trim() !== previo) cuerpo[k] = valor
        }
        // Tipo y número de identificación siempre viajan juntos.
        if ('tipo_identificacion' in cuerpo || 'identificacion' in cuerpo) {
          cuerpo.tipo_identificacion = v.tipo_identificacion
          cuerpo.identificacion = v.identificacion
        }
        const res = await fetch(`/api/admin/crm/contactos/${inicial.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
        })
        const datos = await res.json().catch(() => ({}))
        if (!res.ok) return mostrarError(datos)
        router.push(`/admin/crm/contactos/${inicial.id}?aviso=editado`)
        router.refresh()
        return
      }

      const cuerpo = { tipo, ...v }
      // Antes de crear se muestran las coincidencias (identificación, teléfono, correo).
      if (!confirmado) {
        const res = await fetch('/api/admin/crm/contactos?verificar=1', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
        })
        const datos = await res.json().catch(() => ({}))
        if (!res.ok) return mostrarError(datos)
        if (Array.isArray(datos.coincidencias) && datos.coincidencias.length > 0) {
          setCoincidencias(datos.coincidencias)
          return
        }
      }
      const res = await fetch('/api/admin/crm/contactos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
      })
      const datos = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCoincidencias(null)
        return mostrarError(datos)
      }
      if (onCreado) {
        onCreado({ id: datos.contacto.id, nombre: datos.contacto.nombre })
        return
      }
      router.push(`/admin/crm/contactos/${datos.contacto.id}?aviso=creado`)
      router.refresh()
    } catch {
      setErrorGeneral('No se pudo conectar con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  const tiposId = tipo === 'empresa' ? TIPOS_ID_EMPRESA : TIPOS_ID_PERSONA

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void enviar(false) }}
      noValidate
      className={onCreado ? 'space-y-5' : 'mx-auto max-w-3xl space-y-5 px-6 pb-16 pt-8'}
    >
      {!onCreado && (
        <div className="border-b border-border pb-5">
          <h1 className="font-cinzel text-2xl font-bold uppercase tracking-wider text-gold">
            {editar ? 'Editar contacto' : 'Nuevo contacto'}
          </h1>
        </div>
      )}

      {errorGeneral && <Franja tipo="error">{errorGeneral}</Franja>}

      {coincidencias && (
        <div className="space-y-3 border border-gold/40 bg-card-bg px-5 py-4">
          <p className="font-cinzel text-xs uppercase tracking-[0.2em] text-gold">Posibles coincidencias</p>
          <p className="font-montserrat text-xs leading-relaxed text-text-muted">
            Ya hay fichas parecidas. Revísalas antes de crear una nueva. Si decides crearla, quedará en
            «Duplicados» para que Dirección o coordinación la revise.
          </p>
          <ul className="divide-y divide-border border border-border">
            {coincidencias.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2 font-montserrat text-xs text-text-light">
                <span className="min-w-0 flex-1 truncate">{c.nombre}</span>
                <span className="shrink-0 text-text-muted">{ETIQUETA_COINCIDENCIA[c.coincidencia]}</span>
                <Link href={`/admin/crm/contactos/${c.id}`} target="_blank" className="focus-gold shrink-0 text-gold underline-offset-2 hover:underline">Ver ficha</Link>
              </li>
            ))}
          </ul>
          <div className="flex gap-3">
            <button type="button" disabled={guardando} onClick={() => void enviar(true)} className={BOTON_PRIMARIO}>
              {guardando ? 'Guardando…' : 'Crear de todos modos'}
            </button>
            <button type="button" disabled={guardando} onClick={() => setCoincidencias(null)} className={BOTON_SECUNDARIO}>
              Volver a editar
            </button>
          </div>
        </div>
      )}

      {!editar && (
        <Campo id={id('tipo')} etiqueta="Tipo de contacto">
          <select id={id('tipo')} value={tipo} onChange={(e) => { setTipo(e.target.value as 'persona' | 'empresa'); setV((p) => ({ ...p, tipo_identificacion: '' })) }} className={CLASE_INPUT}>
            <option value="persona">Persona</option>
            <option value="empresa">Empresa</option>
          </select>
        </Campo>
      )}

      {tipo === 'persona' ? (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Campo id={id('nombres')} etiqueta="Nombres" error={errores.nombres}>
              <input id={id('nombres')} value={v.nombres} onChange={set('nombres')} maxLength={120} autoComplete="off" className={CLASE_INPUT} {...ariaError('nombres')} />
            </Campo>
            <Campo id={id('apellidos')} etiqueta="Apellidos" error={errores.apellidos} ayuda={resaltarApellidos ? 'Completar apellidos: el formulario web guardó el nombre completo en «Nombres».' : undefined}>
              <input id={id('apellidos')} value={v.apellidos} onChange={set('apellidos')} maxLength={120} autoComplete="off" className={`${CLASE_INPUT} ${resaltarApellidos ? 'border-gold/60' : ''}`} {...ariaError('apellidos')} />
            </Campo>
          </div>
          <Campo id={id('ocupacion')} etiqueta="Ocupación (opcional)" error={errores.ocupacion}>
            <input id={id('ocupacion')} value={v.ocupacion} onChange={set('ocupacion')} maxLength={120} className={CLASE_INPUT} {...ariaError('ocupacion')} />
          </Campo>
        </>
      ) : (
        <>
          <Campo id={id('razon_social')} etiqueta="Razón social" error={errores.razon_social}>
            <input id={id('razon_social')} value={v.razon_social} onChange={set('razon_social')} maxLength={120} autoComplete="off" className={CLASE_INPUT} {...ariaError('razon_social')} />
          </Campo>
          <div className="grid gap-5 sm:grid-cols-2">
            <Campo id={id('nombre_comercial')} etiqueta="Nombre comercial (opcional)" error={errores.nombre_comercial}>
              <input id={id('nombre_comercial')} value={v.nombre_comercial} onChange={set('nombre_comercial')} maxLength={120} className={CLASE_INPUT} {...ariaError('nombre_comercial')} />
            </Campo>
            <Campo id={id('sector')} etiqueta="Sector (opcional)" error={errores.sector}>
              <input id={id('sector')} value={v.sector} onChange={set('sector')} maxLength={120} className={CLASE_INPUT} {...ariaError('sector')} />
            </Campo>
          </div>
        </>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Campo id={id('tipo_identificacion')} etiqueta="Tipo de identificación (opcional)" error={errores.tipo_identificacion}>
          <select id={id('tipo_identificacion')} value={v.tipo_identificacion} onChange={set('tipo_identificacion')} className={CLASE_INPUT} {...ariaError('tipo_identificacion')}>
            <option value="">Sin identificación</option>
            {tiposId.map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}
          </select>
        </Campo>
        <Campo
          id={id('identificacion')} etiqueta="Número de identificación" error={errores.identificacion}
          ayuda={v.tipo_identificacion === 'ruc' ? 'Si el dígito verificador no cuadra, el RUC se guarda igualmente y se marca «no validado».' : undefined}
        >
          <input id={id('identificacion')} value={v.identificacion} onChange={set('identificacion')} maxLength={30} autoComplete="off" disabled={!v.tipo_identificacion} className={CLASE_INPUT} {...ariaError('identificacion')} />
        </Campo>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Campo id={id('telefono')} etiqueta="Teléfono (opcional)" error={errores.telefono}>
          <input id={id('telefono')} value={v.telefono} onChange={set('telefono')} placeholder="0991234567" maxLength={30} autoComplete="off" className={CLASE_INPUT} {...ariaError('telefono')} />
        </Campo>
        <Campo id={id('correo')} etiqueta="Correo (opcional)" error={errores.correo}>
          <input id={id('correo')} type="email" value={v.correo} onChange={set('correo')} maxLength={254} autoComplete="off" className={CLASE_INPUT} {...ariaError('correo')} />
        </Campo>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Campo id={id('ciudad')} etiqueta="Ciudad (opcional)" error={errores.ciudad}>
          <input id={id('ciudad')} value={v.ciudad} onChange={set('ciudad')} maxLength={80} className={CLASE_INPUT} {...ariaError('ciudad')} />
        </Campo>
        <Campo id={id('preferencia_comunicacion')} etiqueta="Preferencia de comunicación (opcional)" error={errores.preferencia_comunicacion}>
          <select id={id('preferencia_comunicacion')} value={v.preferencia_comunicacion} onChange={set('preferencia_comunicacion')} className={CLASE_INPUT} {...ariaError('preferencia_comunicacion')}>
            <option value="">Sin preferencia</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="correo">Correo</option>
            <option value="llamada">Llamada</option>
          </select>
        </Campo>
      </div>

      <Campo id={id('direccion')} etiqueta="Dirección (opcional)" error={errores.direccion}>
        <input id={id('direccion')} value={v.direccion} onChange={set('direccion')} maxLength={200} className={CLASE_INPUT} {...ariaError('direccion')} />
      </Campo>
      <Campo id={id('como_nos_conocio')} etiqueta="Cómo nos conoció (opcional)" error={errores.como_nos_conocio}>
        <input id={id('como_nos_conocio')} value={v.como_nos_conocio} onChange={set('como_nos_conocio')} maxLength={200} className={CLASE_INPUT} {...ariaError('como_nos_conocio')} />
      </Campo>
      <Campo id={id('notas_internas')} etiqueta="Notas internas (opcional)" error={errores.notas_internas}>
        <textarea id={id('notas_internas')} value={v.notas_internas} onChange={set('notas_internas')} rows={3} maxLength={2000} className={CLASE_INPUT} {...ariaError('notas_internas')} />
      </Campo>

      {!coincidencias && (
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={guardando} className={BOTON_PRIMARIO}>
            {guardando ? 'Guardando…' : editar ? 'Guardar cambios' : 'Crear contacto'}
          </button>
          {!onCreado && <button type="button" onClick={() => router.back()} disabled={guardando} className={BOTON_SECUNDARIO}>Volver</button>}
        </div>
      )}
    </form>
  )
}
