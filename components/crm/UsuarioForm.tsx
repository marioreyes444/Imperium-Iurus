'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Franja from '@/components/crm/Franja'

export type UsuarioInicial = {
  id: string
  rol: string
  nombres: string
  apellidos: string
  correo: string | null
  telefono: string | null
  ciudad: string | null
  es_abogado: boolean
  matricula: string | null
  updated_at: string
}

type Props = {
  modo: 'nuevo' | 'editar'
  roles: { valor: string; etiqueta: string }[]
  inicial?: UsuarioInicial
}

type Campos = Record<string, string>

const CLASE_INPUT =
  'focus-gold w-full border border-border bg-card-bg px-4 py-3 font-montserrat text-sm text-text-light placeholder-text-muted/50 focus:border-gold disabled:opacity-60'
const CLASE_ETIQUETA = 'mb-1.5 block font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-muted'

function Campo({ id, etiqueta, error, children }: { id: string; etiqueta: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={CLASE_ETIQUETA}>{etiqueta}</label>
      {children}
      {error && <p id={`${id}-error`} className="mt-1 font-montserrat text-xs text-red-400">{error}</p>}
    </div>
  )
}

export default function UsuarioForm({ modo, roles, inicial }: Props) {
  const router = useRouter()
  const editar = modo === 'editar'

  const [nombres, setNombres] = useState(inicial?.nombres ?? '')
  const [apellidos, setApellidos] = useState(inicial?.apellidos ?? '')
  const [correo, setCorreo] = useState(inicial?.correo ?? '')
  const [rol, setRol] = useState(inicial?.rol ?? 'asistencia')
  const [telefono, setTelefono] = useState(inicial?.telefono ?? '')
  const [ciudad, setCiudad] = useState(inicial?.ciudad ?? '')
  const [esAbogado, setEsAbogado] = useState(inicial?.es_abogado ?? false)
  const [matricula, setMatricula] = useState(inicial?.matricula ?? '')

  const [errores, setErrores] = useState<Campos>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  // Un asociado es siempre abogado; un externo nunca.
  const abogadoFijo = rol === 'asociado' || rol === 'externo'
  const abogado = rol === 'asociado' ? true : rol === 'externo' ? false : esAbogado

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErrores({})
    setErrorGeneral(null)
    setGuardando(true)

    let url = '/api/admin/crm/usuarios'
    let metodo = 'POST'
    let cuerpo: Record<string, unknown>

    if (editar && inicial) {
      url = `${url}/${inicial.id}`
      metodo = 'PATCH'
      // Solo se envía lo que cambió.
      cuerpo = { updated_at: inicial.updated_at }
      if (nombres.trim() !== inicial.nombres) cuerpo.nombres = nombres
      if (apellidos.trim() !== inicial.apellidos) cuerpo.apellidos = apellidos
      if (rol !== inicial.rol) cuerpo.rol = rol
      if (telefono.trim() !== (inicial.telefono ?? '')) cuerpo.telefono = telefono
      if (ciudad.trim() !== (inicial.ciudad ?? '')) cuerpo.ciudad = ciudad
      if (matricula.trim() !== (inicial.matricula ?? '')) cuerpo.matricula = matricula
    } else {
      cuerpo = { nombres, apellidos, correo, rol, telefono, ciudad, es_abogado: abogado, matricula }
    }

    try {
      const res = await fetch(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      })
      const datos = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (datos.campos && typeof datos.campos === 'object') {
          const { _: general, ...porCampo } = datos.campos as Campos
          setErrores(porCampo)
          setErrorGeneral(general ?? (Object.keys(porCampo).length ? null : datos.error ?? null))
        } else {
          setErrorGeneral(typeof datos.error === 'string' ? datos.error : 'No se pudo guardar.')
        }
        return
      }
      router.push(`/admin/crm/usuarios?aviso=${editar ? 'editado' : 'creado'}`)
      router.refresh()
    } catch {
      setErrorGeneral('No se pudo conectar con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  const id = (c: string) => `usr-${c}`
  const ariaError = (c: string) => (errores[c] ? { 'aria-invalid': true as const, 'aria-describedby': `${id(c)}-error` } : {})

  return (
    <form onSubmit={enviar} noValidate className="mx-auto max-w-2xl space-y-5 px-6 pb-16 pt-8">
      <div className="border-b border-border pb-5">
        <h1 className="font-cinzel text-2xl font-bold uppercase tracking-wider text-gold">
          {editar ? 'Editar usuario' : 'Nuevo usuario'}
        </h1>
        {!editar && (
          <p className="mt-2 font-montserrat text-xs leading-relaxed text-text-muted">
            Se crea la ficha de la persona. El envío de la invitación por correo para que defina su
            contraseña se habilitará más adelante.
          </p>
        )}
      </div>

      {errorGeneral && <Franja tipo="error">{errorGeneral}</Franja>}

      <div className="grid gap-5 sm:grid-cols-2">
        <Campo id={id('nombres')} etiqueta="Nombres" error={errores.nombres}>
          <input id={id('nombres')} value={nombres} onChange={(e) => setNombres(e.target.value)} maxLength={120} autoComplete="off" className={CLASE_INPUT} {...ariaError('nombres')} />
        </Campo>
        <Campo id={id('apellidos')} etiqueta="Apellidos" error={errores.apellidos}>
          <input id={id('apellidos')} value={apellidos} onChange={(e) => setApellidos(e.target.value)} maxLength={120} autoComplete="off" className={CLASE_INPUT} {...ariaError('apellidos')} />
        </Campo>
      </div>

      <Campo id={id('correo')} etiqueta="Correo electrónico" error={errores.correo}>
        <input
          id={id('correo')}
          type="email"
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          maxLength={254}
          disabled={editar}
          autoComplete="off"
          className={CLASE_INPUT}
          {...ariaError('correo')}
        />
        {editar && <p className="mt-1 font-montserrat text-[11px] text-text-muted">El correo no se puede cambiar desde aquí.</p>}
      </Campo>

      <div className="grid gap-5 sm:grid-cols-2">
        <Campo id={id('rol')} etiqueta="Rol" error={errores.rol}>
          <select id={id('rol')} value={rol} onChange={(e) => setRol(e.target.value)} className={CLASE_INPUT} {...ariaError('rol')}>
            {roles.map((r) => <option key={r.valor} value={r.valor}>{r.etiqueta}</option>)}
          </select>
        </Campo>
        <Campo id={id('telefono')} etiqueta="Teléfono (opcional)" error={errores.telefono}>
          <input id={id('telefono')} value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="0991234567" maxLength={20} autoComplete="off" className={CLASE_INPUT} {...ariaError('telefono')} />
        </Campo>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Campo id={id('ciudad')} etiqueta="Ciudad (opcional)" error={errores.ciudad}>
          <input id={id('ciudad')} value={ciudad} onChange={(e) => setCiudad(e.target.value)} maxLength={80} autoComplete="off" className={CLASE_INPUT} {...ariaError('ciudad')} />
        </Campo>
        {abogado && (
          <Campo id={id('matricula')} etiqueta="Matrícula (opcional)" error={errores.matricula}>
            <input id={id('matricula')} value={matricula} onChange={(e) => setMatricula(e.target.value)} maxLength={40} autoComplete="off" className={CLASE_INPUT} {...ariaError('matricula')} />
          </Campo>
        )}
      </div>

      {!editar && (
        <label className="flex items-center gap-3 font-montserrat text-xs text-text-light">
          <input
            type="checkbox"
            checked={abogado}
            disabled={abogadoFijo}
            onChange={(e) => setEsAbogado(e.target.checked)}
            className="focus-gold h-4 w-4 accent-[#C9A646]"
          />
          Es abogado/a{abogadoFijo && <span className="text-text-muted"> ({rol === 'asociado' ? 'siempre para un asociado' : 'nunca para un externo'})</span>}
        </label>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={guardando}
          className="focus-gold border border-gold bg-gold px-6 py-3 font-montserrat text-[10px] font-bold uppercase tracking-widest text-primary transition-colors hover:bg-gold-bright disabled:opacity-60"
        >
          {guardando ? 'Guardando…' : editar ? 'Guardar cambios' : 'Crear usuario'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          disabled={guardando}
          className="focus-gold border border-border px-6 py-3 font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-muted transition-colors hover:border-gold/50 hover:text-gold"
        >
          Volver
        </button>
      </div>
    </form>
  )
}
