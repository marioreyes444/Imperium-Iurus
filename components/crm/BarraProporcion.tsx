type Props = {
  valor: number
  /** Total contra el que se mide (p. ej. la capacidad máxima). */
  total: number
  /** Texto accesible (p. ej. «Carga de Ana: 4 de 5»). */
  etiqueta: string
  /** Resalta la barra cuando se llegó al límite. */
  alLimite?: boolean
}

/**
 * Barra simple en CSS. El número siempre se escribe junto a la barra (el color no es el único
 * significado) y la barra tiene su texto accesible.
 */
export default function BarraProporcion({ valor, total, etiqueta, alLimite = false }: Props) {
  const pct = total > 0 ? Math.min(100, Math.round((valor / total) * 100)) : 0
  return (
    <div
      role="img"
      aria-label={`${etiqueta}: ${valor} de ${total}, ${pct} %`}
      className="h-1.5 w-full bg-border"
    >
      <div className={`h-full ${alLimite ? 'bg-red-500' : 'bg-gold'}`} style={{ width: `${pct}%` }} />
    </div>
  )
}
