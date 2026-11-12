'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PanelAccion from '@/components/crm/PanelAccion'
import Franja from '@/components/crm/Franja'
import { formatoFechaHora } from '@/components/crm/formato'
import { BOTON_SECUNDARIO, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

export type FichaComparar = {
  id: string
  nombre: string
  tipo: string
  tipo_identificacion: string | null
  identificacion: string | null
  telefono: string | null
  correo: string | null
  ciudad: string | null
  etapa_relacion: string
  created_at: string
  solicitudes: number
  fusionado_en: string | null
}

type Props = {
  parId: string
  estado: string
  coincidencia: string
  puedeResolver: boolean
  a: FichaComparar
  b: FichaComparar
  etapas: Record<string, string>
}

const FILAS: { etiqueta: string; valor: (f: FichaComparar, etapas: Record<string, string>) => string }[] = [
  { etiqueta: 'Tipo', valor: (f) => (f.tipo === 'empresa' ? 'Empresa' : 'Persona') },
  { etiqueta: 'Identificación', valor: (f) => (f.identificacion ? `${f.tipo_identificacion ?? ''} ${f.identificacion}` : '—') },
  { etiqueta: 'Teléfono', valor: (f) => f.telefono ?? '—' },
  { etiqueta: 'Correo', valor: (f) => f.correo ?? '—' },
  { etiqueta: 'Ciudad', valor: (f) => f.ciudad ?? '—' },
  { etiqueta: 'Etapa', valor: (f, e) => e[f.etapa_relacion] ?? f.etapa_relacion },
  { etiqueta: 'Solicitudes', valor: (f) => String(f.solicitudes) },
  { etiqueta: 'Alta', valor: (f) => formatoFechaHora(f.created_at) },
]

type Accion = 'fusionar' | 'descartar' | null

export default function DuplicadoComparar({ parId, estado, coincidencia, puedeResolver, a, b, etapas }: Props) {
  const router = useRouter()
  const [conserva, setConserva] = useState<string>(a.id)
  const [accion, setAccion] = useState<Accion>(null)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null)
  const [resultado, setResultado] = useState<string | null>(null)

  const fichaConservada = conserva === a.id ? a : b
  const fichaFusionada = conserva === a.id ? b : a

  function abrir(x: Accion) { setAccion(x); setMotivo(''); setError(null); setErrorMotivo(null) }

  async function ejecutar() {
    if (!accion) return
    setGuardando(true); setError(null); setErrorMotivo(null)
    try {
      const url = `/api/admin/crm/duplicados/${parId}/${accion === 'fusionar' ? 'fusionar' : 'descartar'}`
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accion === 'fusionar' ? { conserva, motivo } : { motivo }),
      })
      const datos = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (datos.campos?.motivo) setErrorMotivo(datos.campos.motivo)
        else setError(typeof datos.error === 'string' ? datos.error : 'No se pudo completar la acción.')
        if (res.status === 409) router.refresh()
        return
      }
      setResultado(accion === 'fusionar' ? 'Fichas fusionadas.' : 'Par descartado: son personas distintas.')
      setAccion(null)
      router.refresh() // recarga los datos desde la base
    } catch {
      setError('No se pudo conectar con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  const resuelto = estado !== 'pendiente' || resultado !== null

  return (
    <div className="space-y-6 px-6 pb-16 pt-8">
      <div className="border-b border-border pb-5">
        <Link href="/admin/crm/duplicados" className="focus-gold font-montserrat text-[10px] uppercase tracking-widest text-text-muted hover:text-gold">← Duplicados</Link>
        <h1 className="mt-2 font-cinzel text-2xl font-bold uppercase tracking-wider text-gold">Comparar fichas</h1>
        <p className="mt-1 font-montserrat text-xs text-text-muted">Coincidencia: {coincidencia === 'correo' ? 'mismo correo' : coincidencia === 'telefono' ? 'mismo teléfono' : 'mismo nombre'}</p>
      </div>

      {resultado && <Franja tipo="exito">{resultado}</Franja>}
      {!resultado && estado !== 'pendiente' && <Franja tipo="info">Este par ya fue resuelto ({estado}).</Franja>}

      <fieldset disabled={resuelto || !puedeResolver} className="min-w-0 border-0 p-0">
        <legend className="sr-only">Elige la ficha que se conserva</legend>
        <div className="grid gap-4 md:grid-cols-2">
          {[a, b].map((f) => (
            <div key={f.id} className={`border bg-card-bg p-5 ${conserva === f.id && !resuelto ? 'border-gold' : 'border-border'}`}>
              <label className="flex items-center gap-3 font-montserrat text-xs text-text-light">
                <input
                  type="radio" name="conserva" value={f.id} checked={conserva === f.id}
                  onChange={() => setConserva(f.id)} className="focus-gold h-4 w-4 accent-[#C9A646]"
                />
                <span className="font-cinzel text-sm uppercase tracking-wider text-gold">{f.nombre}</span>
                <span className="text-text-muted">{resuelto ? (f.fusionado_en ? '(fusionada)' : '') : conserva === f.id ? '(se conserva)' : '(se fusiona)'}</span>
              </label>
              <dl className="mt-4 space-y-2 font-montserrat text-xs">
                {FILAS.map((fila) => (
                  <div key={fila.etiqueta} className="grid grid-cols-[110px_1fr] gap-3">
                    <dt className="text-[10px] uppercase tracking-widest text-text-muted">{fila.etiqueta}</dt>
                    <dd className="min-w-0 truncate text-text-light" title={fila.valor(f, etapas)}>{fila.valor(f, etapas)}</dd>
                  </div>
                ))}
              </dl>
              <Link href={`/admin/crm/contactos/${f.id}`} className="focus-gold mt-4 inline-block font-montserrat text-[10px] uppercase tracking-widest text-gold hover:underline">Ver ficha</Link>
            </div>
          ))}
        </div>
      </fieldset>

      {!resuelto && puedeResolver && !accion && (
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => abrir('fusionar')} className={BOTON_SECUNDARIO}>Fusionar fichas</button>
          <button type="button" onClick={() => abrir('descartar')} className={BOTON_SECUNDARIO}>No son la misma persona</button>
        </div>
      )}
      {!resuelto && !puedeResolver && (
        <Franja tipo="info">Solo Dirección y coordinación pueden fusionar o descartar duplicados.</Franja>
      )}

      {accion && (
        <PanelAccion
          titulo={accion === 'fusionar' ? 'Fusionar fichas' : 'Descartar posible duplicado'}
          delicada guardando={guardando} error={error}
          etiquetaGuardar={accion === 'fusionar' ? 'Fusionar' : 'Descartar'}
          resumen={accion === 'fusionar'
            ? <>Se conserva <strong>{fichaConservada.nombre}</strong>. Las solicitudes, actividades y vínculos de <strong>{fichaFusionada.nombre}</strong> pasan a la ficha conservada y esa ficha queda como fusionada (no se borra nada). No se puede deshacer desde aquí.</>
            : 'El par se marca como descartado y no volverá a proponerse.'}
          onGuardar={ejecutar}
          onCancelar={() => setAccion(null)}
        >
          <div>
            <label htmlFor="dup-motivo" className={CLASE_ETIQUETA}>Motivo (obligatorio)</label>
            <textarea id="dup-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} className={CLASE_INPUT}
              aria-invalid={errorMotivo ? true : undefined} aria-describedby={errorMotivo ? 'dup-motivo-error' : undefined} />
            {errorMotivo && <p id="dup-motivo-error" className="mt-1 font-montserrat text-xs text-red-400">{errorMotivo}</p>}
          </div>
        </PanelAccion>
      )}
    </div>
  )
}
