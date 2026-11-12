'use client'

import { useEffect, useRef } from 'react'

type Props = {
  titulo: string
  /** Resumen de lo que va a ocurrir (acciones delicadas). */
  resumen?: React.ReactNode
  etiquetaGuardar?: string
  delicada?: boolean
  guardando?: boolean
  /** Error general del panel; los de cada campo se muestran junto al campo. */
  error?: string | null
  onGuardar: () => unknown
  onCancelar: () => void
  children?: React.ReactNode
}

/**
 * Acción corta que se despliega dentro de la página (sin modales ni window.confirm).
 * Al abrirse recibe el foco; Escape cancela.
 */
export default function PanelAccion({
  titulo, resumen, etiquetaGuardar = 'Guardar', delicada = false, guardando = false,
  error, onGuardar, onCancelar, children,
}: Props) {
  const ref = useRef<HTMLFormElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <form
      ref={ref}
      tabIndex={-1}
      aria-label={titulo}
      onSubmit={(e) => { e.preventDefault(); void onGuardar() }}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancelar() }}
      className={`border bg-card-bg px-5 py-4 outline-none focus-visible:border-gold ${delicada ? 'border-gold/40' : 'border-border'}`}
    >
      <p className="font-cinzel text-xs uppercase tracking-[0.2em] text-gold">{titulo}</p>
      {resumen && (
        <div className="mt-2 font-montserrat text-xs leading-relaxed text-text-muted">{resumen}</div>
      )}
      {children && <div className="mt-4 space-y-3">{children}</div>}
      {error && (
        <p role="alert" className="mt-3 font-montserrat text-xs text-red-400">{error}</p>
      )}
      <div className="mt-4 flex gap-3">
        <button
          type="submit"
          disabled={guardando}
          className="focus-gold border border-gold bg-gold px-5 py-2 font-montserrat text-[10px] font-bold uppercase tracking-widest text-primary transition-colors hover:bg-gold-bright disabled:opacity-60"
        >
          {guardando ? 'Guardando…' : etiquetaGuardar}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          disabled={guardando}
          className="focus-gold border border-border px-5 py-2 font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-muted transition-colors hover:border-gold/50 hover:text-gold disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
