'use client'

import { usePathname } from 'next/navigation'
import BotonSalir from '@/components/crm/BotonSalir'

const ETIQUETAS: Record<string, string> = {
  crm: 'Tablero',
  usuarios: 'Usuarios',
  nuevo: 'Nuevo',
  editar: 'Editar',
  bitacora: 'Historial',
}

/** "/admin/crm/usuarios/nuevo" → "Usuarios / Nuevo". Los identificadores no se muestran. */
function ubicacion(pathname: string): string {
  const segmentos = pathname.split('/').filter(Boolean).slice(1) // quita "admin"
  const partes = segmentos
    .filter((s) => s in ETIQUETAS)
    .map((s) => ETIQUETAS[s])
  if (partes.length > 1 && partes[0] === 'Tablero') partes.shift()
  return partes.join(' / ') || 'Tablero'
}

type Props = { nombre: string; rolEtiqueta: string }

export default function CrmTopBar({ nombre, rolEtiqueta }: Props) {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-primary/95 px-6 backdrop-blur">
      <p className="font-cinzel text-xs uppercase tracking-[0.25em] text-gold/70">{ubicacion(pathname)}</p>
      <div className="flex items-center gap-4">
        <p className="text-right font-montserrat leading-tight">
          <span className="block text-xs text-text-light">{nombre}</span>
          <span className="block text-[10px] uppercase tracking-widest text-text-muted">{rolEtiqueta}</span>
        </p>
        <BotonSalir />
      </div>
    </header>
  )
}
