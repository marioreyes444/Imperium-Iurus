// Texto normal con un marcador pequeño (sin píldoras de colores). El significado
// nunca depende solo del color: el texto siempre está.
type Relleno = 'ninguno' | 'contorno' | 'dorado' | 'claro' | 'rojo' | 'atenuado'

type Props = {
  texto: string
  forma?: 'punto' | 'cuadrado'
  relleno?: Relleno
  /** Texto resaltado (p. ej. urgencia crítica). */
  resaltado?: boolean
  atenuado?: boolean
}

const MARCADOR: Record<Relleno, string> = {
  ninguno:  '',
  contorno: 'border border-gold bg-transparent',
  dorado:   'bg-gold',
  claro:    'bg-text-light',
  rojo:     'bg-red-500',
  atenuado: 'bg-text-muted/50',
}

export default function Indicador({ texto, forma = 'punto', relleno = 'ninguno', resaltado = false, atenuado = false }: Props) {
  return (
    <span className="inline-flex items-center gap-2 font-montserrat text-xs">
      {relleno !== 'ninguno' && (
        <span
          aria-hidden="true"
          className={`inline-block h-2 w-2 shrink-0 ${forma === 'punto' ? 'rounded-full' : ''} ${MARCADOR[relleno]}`}
        />
      )}
      <span className={resaltado ? 'font-semibold text-text-light' : atenuado ? 'text-text-muted/70' : 'text-text-light'}>
        {texto}
      </span>
    </span>
  )
}
