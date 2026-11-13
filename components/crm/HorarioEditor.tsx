'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Franja from '@/components/crm/Franja'
import { BOTON_BARRA, BOTON_PRIMARIO, CLASE_INPUT } from '@/components/crm/estilos'

type FranjaUI = { clave: number; dia_semana: number; hora_inicio: string; hora_fin: string }
type CitaFuera = { id: string; fecha: string; hora: string; codigo: string | null; solicitud_id: string | null }

const DIAS: [number, string][] = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [7, 'Domingo']]

let siguienteClave = 1

/**
 * Horario semanal de un abogado. Varias franjas por día (para dejar libre el almuerzo). Solo Dirección
 * edita; el resto lo ve en solo lectura. Si el cambio deja citas activas fuera, se guarda igual y se
 * muestran para reagendarlas.
 */
export default function HorarioEditor({ personalId, inicial, editable }: {
  personalId: string
  inicial: { dia_semana: number; hora_inicio: string; hora_fin: string }[]
  editable: boolean
}) {
  const router = useRouter()
  const [franjas, setFranjas] = useState<FranjaUI[]>(() => inicial.map((f) => ({ ...f, clave: siguienteClave++ })))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [exito, setExito] = useState(false)
  const [fuera, setFuera] = useState<CitaFuera[]>([])

  const cambiar = (clave: number, campo: 'hora_inicio' | 'hora_fin', valor: string) =>
    setFranjas((p) => p.map((f) => (f.clave === clave ? { ...f, [campo]: valor } : f)))

  async function guardar() {
    setGuardando(true)
    setError(null)
    setCampos({})
    setExito(false)
    const orden = [...franjas]
    try {
      const res = await fetch(`/api/admin/crm/personal/${personalId}/horarios`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ franjas: orden.map(({ dia_semana, hora_inicio, hora_fin }) => ({ dia_semana, hora_inicio, hora_fin })) }),
      })
      const cuerpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Los errores por campo llegan como «franjas.N.campo»: se muestran junto a la franja N.
        const porClave: Record<string, string> = {}
        for (const [k, v] of Object.entries((cuerpo.campos ?? {}) as Record<string, string>)) {
          const m = /^franjas\.(\d+)\./.exec(k)
          if (m && orden[Number(m[1])]) porClave[String(orden[Number(m[1])].clave)] = v
        }
        setCampos(porClave)
        setError(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo guardar el horario.')
        return
      }
      setFuera((cuerpo.citas_fuera ?? []) as CitaFuera[])
      setExito(true)
      router.refresh()
    } catch {
      setError('No se pudo conectar. Inténtalo de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-4">
      {!editable && <p className="font-montserrat text-xs text-text-muted">Solo Dirección modifica el horario. Lo ves en solo lectura.</p>}
      <div className="divide-y divide-border border border-border bg-card-bg">
        {DIAS.map(([dia, nombre]) => {
          const del = franjas.filter((f) => f.dia_semana === dia).sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio))
          return (
            <div key={dia} className="flex flex-wrap items-start gap-4 px-5 py-3">
              <p className="w-24 pt-2 font-montserrat text-xs uppercase tracking-widest text-text-muted">{nombre}</p>
              <div className="min-w-0 flex-1 space-y-2">
                {del.length === 0 && <p className="pt-2 font-montserrat text-xs text-text-muted/70">No atiende</p>}
                {del.map((f) => (
                  <div key={f.clave}>
                    {editable ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`hi-${f.clave}`}>{nombre}: desde</label>
                        <input id={`hi-${f.clave}`} type="time" step={900} value={f.hora_inicio} onChange={(e) => cambiar(f.clave, 'hora_inicio', e.target.value)} className={`${CLASE_INPUT} w-36`} />
                        <span className="font-montserrat text-xs text-text-muted">a</span>
                        <label className="sr-only" htmlFor={`hf-${f.clave}`}>{nombre}: hasta</label>
                        <input id={`hf-${f.clave}`} type="time" step={900} value={f.hora_fin} onChange={(e) => cambiar(f.clave, 'hora_fin', e.target.value)} className={`${CLASE_INPUT} w-36`} />
                        <button type="button" onClick={() => setFranjas((p) => p.filter((x) => x.clave !== f.clave))} className={BOTON_BARRA}>Quitar</button>
                      </div>
                    ) : (
                      <p className="pt-2 font-montserrat text-sm text-text-light">{f.hora_inicio} a {f.hora_fin}</p>
                    )}
                    {campos[String(f.clave)] && <p className="mt-1 font-montserrat text-xs text-red-400">{campos[String(f.clave)]}</p>}
                  </div>
                ))}
                {editable && (
                  <button type="button" onClick={() => setFranjas((p) => [...p, { clave: siguienteClave++, dia_semana: dia, hora_inicio: '09:00', hora_fin: '13:00' }])} className={BOTON_BARRA}>
                    + Franja
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {error && <Franja tipo="error">{error}</Franja>}
      {exito && (
        <Franja tipo="exito">
          Horario guardado.
          {fuera.length > 0 && (
            <>
              {' '}Estas citas activas quedaron fuera del horario y conviene reagendarlas:
              <ul className="mt-2 list-inside list-disc">
                {fuera.map((c) => (
                  <li key={c.id}>
                    {c.fecha} {c.hora}{c.codigo ? ` · ${c.codigo}` : ''}{' — '}
                    <Link href={`/admin/crm/citas/${c.id}/reagendar`} className="focus-gold underline underline-offset-2">Reagendar</Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Franja>
      )}
      {editable && (
        <button type="button" onClick={() => void guardar()} disabled={guardando} className={BOTON_PRIMARIO}>
          {guardando ? 'Guardando…' : 'Guardar horario'}
        </button>
      )}
    </div>
  )
}
