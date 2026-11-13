'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Franja from '@/components/crm/Franja'
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

export type FichaInicial = {
  id: string
  rol: string
  nombres: string
  apellidos: string
  es_abogado: boolean
  matricula: string | null
  habilitacion_verificada: boolean
  especialidad: string | null
  capacidad_maxima: number | null
  fecha_vinculacion: string | null
  acuerdo_confidencialidad: boolean
  ciudad: string | null
  updated_at: string
}

type Props = {
  ficha: FichaInicial
  areas: { id: string; nombre: string }[]
  areasIniciales: { area_id: string; rol_referencia: string; competencia_acreditada: boolean }[]
  catalogoDisponible: boolean
}

type Campos = Record<string, string>

function Campo({ id, etiqueta, error, children }: { id: string; etiqueta: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={CLASE_ETIQUETA}>{etiqueta}</label>
      {children}
      {error && <p id={`${id}-error`} className="mt-1 font-montserrat text-xs text-red-400">{error}</p>}
    </div>
  )
}

/** Edición de la ficha del personal (datos profesionales) y de sus áreas de referencia (R-28). */
export default function PersonalForm({ ficha, areas, areasIniciales, catalogoDisponible }: Props) {
  const router = useRouter()
  const [version, setVersion] = useState(ficha.updated_at)
  const [esAbogado, setEsAbogado] = useState(ficha.es_abogado)
  const [matricula, setMatricula] = useState(ficha.matricula ?? '')
  const [verificada, setVerificada] = useState(ficha.habilitacion_verificada)
  const [especialidad, setEspecialidad] = useState(ficha.especialidad ?? '')
  const [capacidad, setCapacidad] = useState(ficha.capacidad_maxima === null ? '' : String(ficha.capacidad_maxima))
  const [vinculacion, setVinculacion] = useState(ficha.fecha_vinculacion ?? '')
  const [acuerdo, setAcuerdo] = useState(ficha.acuerdo_confidencialidad)
  const [ciudad, setCiudad] = useState(ficha.ciudad ?? '')
  const [errores, setErrores] = useState<Campos>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const [refs, setRefs] = useState<Record<string, string>>(
    () => Object.fromEntries(areasIniciales.map((a) => [a.area_id, a.rol_referencia])),
  )
  const [guardandoAreas, setGuardandoAreas] = useState(false)
  const [errorAreas, setErrorAreas] = useState<string | null>(null)
  const [exitoAreas, setExitoAreas] = useState<string | null>(null)

  const abogadoFijo = ficha.rol === 'asociado' || ficha.rol === 'externo'
  const abogado = ficha.rol === 'asociado' ? true : ficha.rol === 'externo' ? false : esAbogado

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setErrores({}); setErrorGeneral(null); setExito(null); setGuardando(true)

    const cuerpo: Record<string, unknown> = { updated_at: version }
    if (abogado !== ficha.es_abogado) cuerpo.es_abogado = abogado
    if (matricula.trim() !== (ficha.matricula ?? '')) cuerpo.matricula = matricula
    if (verificada !== ficha.habilitacion_verificada) cuerpo.habilitacion_verificada = verificada
    if (especialidad.trim() !== (ficha.especialidad ?? '')) cuerpo.especialidad = especialidad
    if (capacidad.trim() !== (ficha.capacidad_maxima === null ? '' : String(ficha.capacidad_maxima))) {
      cuerpo.capacidad_maxima = capacidad.trim() === '' ? null : Number(capacidad)
    }
    if (vinculacion !== (ficha.fecha_vinculacion ?? '')) cuerpo.fecha_vinculacion = vinculacion
    if (acuerdo !== ficha.acuerdo_confidencialidad) cuerpo.acuerdo_confidencialidad = acuerdo
    if (ciudad.trim() !== (ficha.ciudad ?? '')) cuerpo.ciudad = ciudad

    try {
      const res = await fetch(`/api/admin/crm/personal/${ficha.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
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
        if (res.status === 409) router.refresh()
        return
      }
      if (datos.ficha?.updated_at) setVersion(datos.ficha.updated_at)
      setExito('Cambios guardados.')
      router.refresh()
    } catch {
      setErrorGeneral('No se pudo conectar con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  async function guardarAreas() {
    setErrorAreas(null); setExitoAreas(null); setGuardandoAreas(true)
    const lista = Object.entries(refs).filter(([, r]) => r).map(([area_id, rol_referencia]) => ({ area_id, rol_referencia }))
    try {
      const res = await fetch(`/api/admin/crm/personal/${ficha.id}/areas`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ areas: lista }),
      })
      const datos = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrorAreas(typeof datos.error === 'string' ? datos.error : 'No se pudieron guardar las áreas.')
        // El guardado de áreas no es atómico: se muestra el estado real que quedó.
        const reales = datos.datos?.areas as { area_id: string; rol_referencia: string }[] | undefined
        if (reales) setRefs(Object.fromEntries(reales.map((a) => [a.area_id, a.rol_referencia])))
        return
      }
      setExitoAreas('Áreas guardadas.')
      router.refresh()
    } catch {
      setErrorAreas('No se pudo conectar con el servidor.')
    } finally {
      setGuardandoAreas(false)
    }
  }

  const id = (c: string) => `per-${c}`
  const ariaError = (c: string) => (errores[c] ? { 'aria-invalid': true as const, 'aria-describedby': `${id(c)}-error` } : {})

  return (
    <div className="mx-auto max-w-2xl space-y-10 px-6 pb-16 pt-8">
      <form onSubmit={guardar} noValidate className="space-y-5">
        <div className="border-b border-border pb-5">
          <Link href={`/admin/crm/personal/${ficha.id}`} className="focus-gold font-montserrat text-[10px] uppercase tracking-widest text-text-muted hover:text-gold">← Ficha</Link>
          <h1 className="mt-2 font-cinzel text-2xl font-bold uppercase tracking-wider text-gold">Editar ficha</h1>
          <p className="mt-2 font-montserrat text-xs text-text-muted">{ficha.nombres} {ficha.apellidos}. El rol y la activación se cambian en «Usuarios» (solo Dirección).</p>
        </div>

        {errorGeneral && <Franja tipo="error">{errorGeneral}</Franja>}
        {exito && <Franja tipo="exito">{exito}</Franja>}

        <label className="flex items-center gap-2 font-montserrat text-xs text-text-light">
          <input type="checkbox" checked={abogado} disabled={abogadoFijo} onChange={(e) => setEsAbogado(e.target.checked)} className="focus-gold" />
          Es abogado{abogadoFijo && <span className="text-text-muted"> ({ficha.rol === 'asociado' ? 'un asociado siempre lo es' : 'un externo no ejerce patrocinio'})</span>}
        </label>
        {errores.es_abogado && <p className="font-montserrat text-xs text-red-400">{errores.es_abogado}</p>}

        <div className="grid gap-5 sm:grid-cols-2">
          <Campo id={id('matricula')} etiqueta="Matrícula" error={errores.matricula}>
            <input id={id('matricula')} value={matricula} onChange={(e) => setMatricula(e.target.value)} maxLength={40} className={CLASE_INPUT} {...ariaError('matricula')} />
          </Campo>
          <Campo id={id('ciudad')} etiqueta="Ciudad" error={errores.ciudad}>
            <input id={id('ciudad')} value={ciudad} onChange={(e) => setCiudad(e.target.value)} maxLength={80} className={CLASE_INPUT} {...ariaError('ciudad')} />
          </Campo>
          <Campo id={id('especialidad')} etiqueta="Especialidad (peritos y colaboradores)" error={errores.especialidad}>
            <input id={id('especialidad')} value={especialidad} onChange={(e) => setEspecialidad(e.target.value)} maxLength={120} className={CLASE_INPUT} {...ariaError('especialidad')} />
          </Campo>
          <Campo id={id('capacidad')} etiqueta="Capacidad máxima (casos como titular)" error={errores.capacidad_maxima}>
            <input id={id('capacidad')} type="number" min={1} step={1} value={capacidad} onChange={(e) => setCapacidad(e.target.value)}
              placeholder="Vacío = sin límite" className={CLASE_INPUT} aria-invalid={errores.capacidad_maxima ? true : undefined} />
          </Campo>
          <Campo id={id('vinculacion')} etiqueta="Fecha de vinculación" error={errores.fecha_vinculacion}>
            <input id={id('vinculacion')} type="date" value={vinculacion} onChange={(e) => setVinculacion(e.target.value)} className={CLASE_INPUT} />
          </Campo>
        </div>

        <label className="flex items-center gap-2 font-montserrat text-xs text-text-light">
          <input type="checkbox" checked={verificada} disabled={!abogado} onChange={(e) => setVerificada(e.target.checked)} className="focus-gold" />
          Habilitación profesional verificada (requiere matrícula; sin ella no puede ser titular, suplente ni coordinador)
        </label>
        {errores.habilitacion_verificada && <p className="font-montserrat text-xs text-red-400">{errores.habilitacion_verificada}</p>}

        <label className="flex items-center gap-2 font-montserrat text-xs text-text-light">
          <input type="checkbox" checked={acuerdo} onChange={(e) => setAcuerdo(e.target.checked)} className="focus-gold" />
          Acuerdo de confidencialidad firmado (obligatorio para participar como perito externo)
        </label>

        <div className="flex gap-3">
          <button type="submit" disabled={guardando} className={BOTON_PRIMARIO}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          <Link href={`/admin/crm/personal/${ficha.id}`} className={BOTON_SECUNDARIO}>Volver</Link>
        </div>
      </form>

      {abogado && (
        <section aria-labelledby="per-areas" className="space-y-4 border-t border-border pt-8">
          <div>
            <h2 id="per-areas" className="font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80">Áreas de referencia</h2>
            <p className="mt-1 font-montserrat text-[11px] leading-relaxed text-text-muted">
              Un titular y un suplente de referencia por área, ambos abogados activos. Ordenan las sugerencias de asignación; no dan acceso a ningún caso.
            </p>
          </div>
          {errorAreas && <Franja tipo="error">{errorAreas}</Franja>}
          {exitoAreas && <Franja tipo="exito">{exitoAreas}</Franja>}
          {!catalogoDisponible || areas.length === 0 ? (
            <Franja tipo="info">El catálogo de áreas de práctica aún no está disponible en este entorno, así que no se pueden vincular áreas.</Franja>
          ) : (
            <>
              <ul className="divide-y divide-border border border-border bg-card-bg">
                {areas.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <label htmlFor={`ref-${a.id}`} className="font-montserrat text-xs text-text-light">{a.nombre}</label>
                    <select id={`ref-${a.id}`} value={refs[a.id] ?? ''} onChange={(e) => setRefs((r) => ({ ...r, [a.id]: e.target.value }))}
                      className="focus-gold border border-border bg-card-bg px-3 py-2 font-montserrat text-xs text-text-light focus:border-gold">
                      <option value="">Sin vínculo</option>
                      <option value="titular">Titular de referencia</option>
                      <option value="suplente">Suplente de referencia</option>
                      <option value="miembro">Miembro</option>
                    </select>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={guardarAreas} disabled={guardandoAreas} className={BOTON_PRIMARIO}>
                {guardandoAreas ? 'Guardando…' : 'Guardar áreas'}
              </button>
            </>
          )}
        </section>
      )}
    </div>
  )
}
