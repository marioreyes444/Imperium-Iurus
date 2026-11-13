'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Franja from '@/components/crm/Franja'
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

type Sugerencia = {
  personal_id: string
  nombre: string
  grupo: 'titular_ref' | 'suplente_ref' | 'area' | 'otros'
  carga: number
  capacidad: number | null
  en_limite: boolean
  misma_ciudad: boolean
}
type Respuesta = { items: Sugerencia[]; sin_area: boolean; sin_referencias: boolean }
type Otra = { id: string; nombres: string; apellidos: string; rol: string; es_abogado: boolean }

const GRUPO: Record<Sugerencia['grupo'], string> = {
  titular_ref: 'Titular de referencia del área',
  suplente_ref: 'Suplente de referencia del área',
  area: 'Abogado habilitado del área',
  otros: 'Abogado habilitado',
}

const ROLES_EQUIPO = [
  { valor: 'titular', etiqueta: 'Titular' },
  { valor: 'suplente', etiqueta: 'Suplente' },
  { valor: 'coordinador', etiqueta: 'Coordinador' },
  { valor: 'apoyo', etiqueta: 'Apoyo' },
  { valor: 'perito', etiqueta: 'Perito (externo)' },
]

type Props = { solicitudId: string; codigo: string; admiteEquipo: boolean; conflictoOk: boolean }

/** «Asignar equipo»: sugerencias con carga/capacidad (R-25) y propuesta (paso 1 de la asignación). */
export default function ProponerEquipoForm({ solicitudId, codigo, admiteEquipo, conflictoOk }: Props) {
  const router = useRouter()
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [otras, setOtras] = useState<Otra[] | null>(null)
  const [verOtras, setVerOtras] = useState(false)
  const [personalId, setPersonalId] = useState('')
  const [rol, setRol] = useState('titular')
  const [funciones, setFunciones] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})

  useEffect(() => {
    let vigente = true
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/crm/solicitudes/${solicitudId}/sugerencias`, { cache: 'no-store' })
        const cuerpo = await res.json().catch(() => ({}))
        if (!vigente) return
        if (!res.ok) setErrorCarga(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudieron cargar las sugerencias.')
        else setDatos(cuerpo as Respuesta)
      } catch {
        if (vigente) setErrorCarga('No se pudo conectar con el servidor.')
      }
    })()
    return () => { vigente = false }
  }, [solicitudId])

  useEffect(() => {
    if (!verOtras || otras) return
    let vigente = true
    ;(async () => {
      try {
        const res = await fetch('/api/admin/crm/personal?limite=50', { cache: 'no-store' })
        const cuerpo = await res.json().catch(() => ({}))
        if (vigente) setOtras(res.ok ? (cuerpo.items as Otra[]) : [])
      } catch {
        if (vigente) setOtras([])
      }
    })()
    return () => { vigente = false }
  }, [verOtras, otras])

  async function proponer(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setCampos({})
    if (!personalId) { setError('Elige a la persona que vas a proponer.'); return }
    setGuardando(true)
    try {
      const res = await fetch(`/api/admin/crm/solicitudes/${solicitudId}/equipo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personal_id: personalId, rol, funciones: funciones || undefined }),
      })
      const cuerpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (cuerpo.campos && typeof cuerpo.campos === 'object') setCampos(cuerpo.campos as Record<string, string>)
        setError(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo proponer.')
        return
      }
      router.push(`/admin/crm/solicitudes/${solicitudId}?tab=equipo`)
      router.refresh()
    } catch {
      setError('No se pudo conectar con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={proponer} noValidate className="mx-auto max-w-3xl space-y-5 px-6 pb-16 pt-8">
      <div className="border-b border-border pb-5">
        <Link href={`/admin/crm/solicitudes/${solicitudId}?tab=equipo`} className="focus-gold font-montserrat text-[10px] uppercase tracking-widest text-text-muted hover:text-gold">← {codigo}</Link>
        <h1 className="mt-2 font-cinzel text-2xl font-bold uppercase tracking-wider text-gold">Asignar equipo</h1>
        <p className="mt-2 font-montserrat text-xs leading-relaxed text-text-muted">
          Esto solo propone. Dirección aprueba y la persona asignada confirma después.
        </p>
      </div>

      {!admiteEquipo && <Franja tipo="info">El equipo se propone cuando Dirección acepta el encargo.</Franja>}
      {admiteEquipo && !conflictoOk && <Franja tipo="error">Falta la revisión de conflictos con resultado «Sin conflicto».</Franja>}
      {error && <Franja tipo="error">{error}</Franja>}
      {errorCarga && <Franja tipo="error">{errorCarga}</Franja>}

      <fieldset className="space-y-2">
        <legend className={CLASE_ETIQUETA}>Sugerencias</legend>
        {datos?.sin_area && <Franja tipo="info">El caso aún no tiene área principal: se muestran todos los abogados habilitados.</Franja>}
        {datos?.sin_referencias && <Franja tipo="info">El área no tiene personal vinculado (o el catálogo no está disponible): se muestran todos los abogados habilitados.</Franja>}
        {!datos && !errorCarga && <p className="font-montserrat text-xs text-text-muted">Cargando sugerencias…</p>}
        {datos && datos.items.length === 0 && (
          <p className="font-montserrat text-xs text-text-muted">No hay abogados habilitados disponibles. Verifica la habilitación en «Personal» o elige a otra persona.</p>
        )}
        {datos && datos.items.length > 0 && (
          <ul className="divide-y divide-border border border-border bg-card-bg">
            {datos.items.map((s) => (
              <li key={s.personal_id}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-3 font-montserrat text-xs focus-within:bg-gold/5">
                  <input type="radio" name="persona" value={s.personal_id} checked={personalId === s.personal_id}
                    onChange={() => setPersonalId(s.personal_id)} className="focus-gold mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm text-text-light">{s.nombre}</span>
                    <span className="block text-text-muted">
                      {GRUPO[s.grupo]} · Carga {s.carga}{s.capacidad !== null ? ` de ${s.capacidad}` : ' (sin límite)'}
                      {s.misma_ciudad && ' · misma ciudad que el contacto'}
                    </span>
                    {s.en_limite && <span className="block text-gold">En su límite de capacidad: aprobarla exigirá la autorización de Dirección con motivo.</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div>
        <button type="button" onClick={() => setVerOtras((v) => !v)} className="focus-gold font-montserrat text-[11px] text-gold underline underline-offset-2">
          {verOtras ? 'Ocultar otras personas' : 'Elegir a otra persona (apoyo, perito…)'}
        </button>
        {verOtras && (
          <div className="mt-3">
            <label htmlFor="otra" className={CLASE_ETIQUETA}>Persona</label>
            <select id="otra" value={personalId} onChange={(e) => setPersonalId(e.target.value)} className={CLASE_INPUT}>
              <option value="">{otras === null ? 'Cargando…' : 'Elige una persona'}</option>
              {(otras ?? []).map((o) => <option key={o.id} value={o.id}>{o.nombres} {o.apellidos} · {o.rol}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="rol" className={CLASE_ETIQUETA}>Rol en el equipo</label>
          <select id="rol" value={rol} onChange={(e) => setRol(e.target.value)} className={CLASE_INPUT} aria-invalid={campos.rol ? true : undefined}>
            {ROLES_EQUIPO.map((r) => <option key={r.valor} value={r.valor}>{r.etiqueta}</option>)}
          </select>
          {campos.rol && <p className="mt-1 font-montserrat text-xs text-red-400">{campos.rol}</p>}
        </div>
        <div>
          <label htmlFor="funciones" className={CLASE_ETIQUETA}>Funciones (opcional)</label>
          <input id="funciones" value={funciones} maxLength={500} onChange={(e) => setFunciones(e.target.value)} className={CLASE_INPUT} />
          {campos.funciones && <p className="mt-1 font-montserrat text-xs text-red-400">{campos.funciones}</p>}
        </div>
      </div>

      <div className="flex gap-3">
        <button type="submit" disabled={guardando || !admiteEquipo || !conflictoOk} className={BOTON_PRIMARIO}>{guardando ? 'Proponiendo…' : 'Proponer'}</button>
        <Link href={`/admin/crm/solicitudes/${solicitudId}?tab=equipo`} className={BOTON_SECUNDARIO}>Cancelar</Link>
      </div>
    </form>
  )
}
