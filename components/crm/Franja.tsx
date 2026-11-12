type Props = {
  tipo: 'exito' | 'error' | 'info'
  children: React.ReactNode
}

const ESTILOS: Record<Props['tipo'], string> = {
  exito: 'border-gold/40 bg-gold/5 text-gold',
  error: 'border-red-500/40 bg-red-950/30 text-red-300',
  info:  'border-border bg-card-bg text-text-muted',
}

/** Resultado de una acción, dentro de la página (no flotante). */
export default function Franja({ tipo, children }: Props) {
  return (
    <div
      role={tipo === 'error' ? 'alert' : 'status'}
      aria-live={tipo === 'error' ? 'assertive' : 'polite'}
      className={`border px-4 py-3 font-montserrat text-xs leading-relaxed ${ESTILOS[tipo]}`}
    >
      {children}
    </div>
  )
}
