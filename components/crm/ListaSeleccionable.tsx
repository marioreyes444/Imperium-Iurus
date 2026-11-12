'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'

export type Columna<T> = {
  clave: string
  titulo: string
  /** Ancho fijo de la columna (p. ej. '22%' o '140px'): la tabla no se reacomoda. */
  ancho: string
  render: (fila: T) => React.ReactNode
  /** Texto completo para el `title` cuando el contenido se corta. */
  texto?: (fila: T) => string
}

export type FiltroDef = {
  nombre: string
  etiqueta: string
  tipo: 'select' | 'date' | 'text'
  opciones?: { valor: string; etiqueta: string }[]
}

export type ContextoAcciones = {
  recargar: () => void
  limpiarSeleccion: () => void
}

type Props<T> = {
  titulo: string
  /** Ruta que responde `{ items, siguienteCursor, total }`. */
  endpoint: string
  /** Parámetros que siempre se envían (p. ej. `validacion=true` en la bandeja de validación). */
  parametrosFijos?: Record<string, string>
  columnas: Columna<T>[]
  idDe: (fila: T) => string
  /** Descripción de la fila seleccionada para la barra de acciones. */
  etiquetaSeleccion: (fila: T) => string
  singular: string
  plural: string
  buscador?: { placeholder: string }
  filtros?: FiltroDef[]
  accionPrincipal?: { href: string; etiqueta: string }
  /** Solo los botones que el rol puede usar. No existe "Eliminar". */
  barraAcciones?: (seleccionada: T | null, ctx: ContextoAcciones) => React.ReactNode
  /** Panel de acción desplegado bajo la barra. */
  panel?: (seleccionada: T | null, ctx: ContextoAcciones) => React.ReactNode
  /** Franja de resultado (éxito o error) dentro de la página. */
  mensaje?: React.ReactNode
  vacio: React.ReactNode
  /** Se llama al cambiar la selección (para cerrar paneles abiertos). */
  onCambioSeleccion?: (id: string | null) => void
}

type Respuesta<T> = { items: T[]; siguienteCursor: string | null; total: number }

const LIMITE = 30
const ESPERA_BUSCADOR_MS = 250

/** Patrón de listado obligatorio del CRM (sección 9.3). */
export default function ListaSeleccionable<T>({
  titulo, endpoint, parametrosFijos, columnas, idDe, etiquetaSeleccion, singular, plural, buscador, filtros = [],
  accionPrincipal, barraAcciones, panel, mensaje, vacio, onCambioSeleccion,
}: Props<T>) {
  const params = useSearchParams()

  // Búsqueda y filtros viven en la URL: al volver desde un formulario se conservan.
  const [q, setQ] = useState(() => params.get('q') ?? '')
  const [qAplicada, setQAplicada] = useState(q)
  const [valores, setValores] = useState<Record<string, string>>(() => {
    const ini: Record<string, string> = {}
    for (const f of filtros) ini[f.nombre] = params.get(f.nombre) ?? ''
    return ini
  })

  const [items, setItems] = useState<T[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const peticion = useRef(0)
  const centinela = useRef<HTMLDivElement>(null)

  // Espera ~250 ms tras la última tecla antes de consultar.
  useEffect(() => {
    const t = setTimeout(() => setQAplicada(q.trim()), ESPERA_BUSCADOR_MS)
    return () => clearTimeout(t)
  }, [q])

  const urlDe = useCallback((cursorActual: string | null) => {
    const p = new URLSearchParams(parametrosFijos)
    if (qAplicada) p.set('q', qAplicada)
    for (const [k, v] of Object.entries(valores)) if (v) p.set(k, v)
    p.set('limite', String(LIMITE))
    if (cursorActual) p.set('cursor', cursorActual)
    return `${endpoint}?${p.toString()}`
  }, [endpoint, parametrosFijos, qAplicada, valores])

  const cargar = useCallback(async (reiniciar: boolean, cursorActual: string | null) => {
    const token = ++peticion.current
    setCargando(true)
    setError(null)
    try {
      const res = await fetch(urlDe(cursorActual), { cache: 'no-store' })
      const cuerpo = await res.json().catch(() => ({}))
      if (token !== peticion.current) return // llegó una respuesta más nueva
      if (!res.ok) {
        setError(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo cargar la lista.')
        if (reiniciar) { setItems([]); setCursor(null); setTotal(0) }
        return
      }
      const datos = cuerpo as Respuesta<T>
      setItems((previos) => (reiniciar ? datos.items : [...previos, ...datos.items]))
      setCursor(datos.siguienteCursor)
      setTotal(datos.total)
    } catch {
      if (token === peticion.current) setError('No se pudo conectar con el servidor.')
    } finally {
      if (token === peticion.current) setCargando(false)
    }
  }, [urlDe])

  // Cambiar búsqueda o filtros (o recargar): reinicia la lista y limpia la selección.
  useEffect(() => {
    setSeleccion(null)
    onCambioSeleccion?.(null)
    void cargar(true, null)
    // Refleja búsqueda y filtros en la URL sin recargar la página.
    const p = new URLSearchParams()
    if (qAplicada) p.set('q', qAplicada)
    for (const [k, v] of Object.entries(valores)) if (v) p.set(k, v)
    const consulta = p.toString()
    window.history.replaceState(null, '', consulta ? `?${consulta}` : window.location.pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qAplicada, valores, version])

  // Carga progresiva: al acercarse al final se trae el siguiente lote.
  const masRef = useRef<() => void>(() => {})
  masRef.current = () => {
    if (cursor && !cargando) void cargar(false, cursor)
  }
  useEffect(() => {
    const nodo = centinela.current
    if (!nodo) return
    const obs = new IntersectionObserver(
      (entradas) => { if (entradas.some((e) => e.isIntersecting)) masRef.current() },
      { rootMargin: '200px' },
    )
    obs.observe(nodo)
    return () => obs.disconnect()
  }, [])

  function alternar(id: string) {
    const nuevo = seleccion === id ? null : id
    setSeleccion(nuevo)
    onCambioSeleccion?.(nuevo)
  }

  const filaSeleccionada = items.find((f) => idDe(f) === seleccion) ?? null
  const hayFiltros = qAplicada !== '' || Object.values(valores).some(Boolean)

  const ctx: ContextoAcciones = {
    recargar: () => setVersion((v) => v + 1),
    limpiarSeleccion: () => { setSeleccion(null); onCambioSeleccion?.(null) },
  }

  return (
    <div className="flex flex-col min-[820px]:h-[calc(100vh-3.5rem)]">
      {/* ── Parte superior fija ─────────────────────────────────────────── */}
      <div className="shrink-0 space-y-4 px-6 pb-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-cinzel text-2xl font-bold uppercase tracking-wider text-gold">{titulo}</h1>
          {accionPrincipal && (
            <Link
              href={accionPrincipal.href}
              className="focus-gold border border-gold bg-gold px-5 py-2.5 font-montserrat text-[10px] font-bold uppercase tracking-widest text-primary transition-colors hover:bg-gold-bright"
            >
              {accionPrincipal.etiqueta}
            </Link>
          )}
        </div>

        {(buscador || filtros.length > 0) && (
          <div className="flex flex-wrap items-end gap-3">
            {buscador && (
              <div className="relative min-w-[220px] flex-1">
                <label htmlFor="crm-buscar" className="sr-only">Buscar</label>
                <Search size={14} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  id="crm-buscar"
                  type="search"
                  value={q}
                  maxLength={80}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={buscador.placeholder}
                  className="focus-gold w-full border border-border bg-card-bg py-2.5 pl-9 pr-3 font-montserrat text-xs text-text-light placeholder-text-muted/60 focus:border-gold"
                />
              </div>
            )}
            {filtros.map((f) => (
              <div key={f.nombre}>
                <label htmlFor={`crm-f-${f.nombre}`} className="mb-1 block font-montserrat text-[10px] uppercase tracking-widest text-text-muted">
                  {f.etiqueta}
                </label>
                {f.tipo === 'select' ? (
                  <select
                    id={`crm-f-${f.nombre}`}
                    value={valores[f.nombre] ?? ''}
                    onChange={(e) => setValores((v) => ({ ...v, [f.nombre]: e.target.value }))}
                    className="focus-gold border border-border bg-card-bg px-3 py-2.5 font-montserrat text-xs text-text-light focus:border-gold"
                  >
                    <option value="">Todos</option>
                    {f.opciones?.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                  </select>
                ) : (
                  <input
                    id={`crm-f-${f.nombre}`}
                    type={f.tipo}
                    value={valores[f.nombre] ?? ''}
                    onChange={(e) => setValores((v) => ({ ...v, [f.nombre]: e.target.value }))}
                    className="focus-gold border border-border bg-card-bg px-3 py-2 font-montserrat text-xs text-text-light focus:border-gold"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Barra de acciones */}
        <div className="flex flex-wrap items-center gap-3 border border-border bg-card-bg px-4 py-2.5">
          <p aria-live="polite" className="flex-1 font-montserrat text-xs text-text-muted">
            {filaSeleccionada
              ? <>Seleccionado: <span className="text-text-light">{etiquetaSeleccion(filaSeleccionada)}</span></>
              : `Ningún ${singular} seleccionado`}
          </p>
          {barraAcciones?.(filaSeleccionada, ctx)}
        </div>

        {mensaje}
        {panel?.(filaSeleccionada, ctx)}
      </div>

      {/* ── Lista: solo se desplaza el cuerpo ───────────────────────────── */}
      <div className="px-6 pb-6 min-[820px]:min-h-0 min-[820px]:flex-1 min-[820px]:overflow-auto">
        <table role="grid" aria-label={titulo} className="w-full table-fixed border-collapse">
          <colgroup>
            {columnas.map((c) => <col key={c.clave} style={{ width: c.ancho }} />)}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-primary">
            <tr className="border-b border-border">
              {columnas.map((c) => (
                <th key={c.clave} scope="col" className="px-3 py-2.5 text-left font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-muted">
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((fila) => {
              const id = idDe(fila)
              const activa = id === seleccion
              return (
                <tr
                  key={id}
                  role="row"
                  tabIndex={0}
                  aria-selected={activa}
                  onClick={() => alternar(id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(id) }
                  }}
                  className={`cursor-pointer border-b border-border/60 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-gold ${
                    activa ? 'bg-gold/10' : 'hover:bg-white/5'
                  }`}
                >
                  {columnas.map((c) => (
                    <td
                      key={c.clave}
                      title={c.texto?.(fila)}
                      className="overflow-hidden text-ellipsis whitespace-nowrap px-3 py-3 font-montserrat text-xs text-text-light"
                    >
                      {c.render(fila)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>

        {error && (
          <p role="alert" className="mt-4 font-montserrat text-xs text-red-400">{error}</p>
        )}
        {!cargando && !error && items.length === 0 && (
          <div className="mt-8 text-center font-montserrat text-xs leading-relaxed text-text-muted">
            {hayFiltros ? 'Ningún resultado con esa búsqueda o esos filtros.' : vacio}
          </div>
        )}
        {cargando && (
          <p aria-live="polite" className="mt-4 font-montserrat text-xs text-text-muted">Cargando…</p>
        )}
        <div ref={centinela} aria-hidden="true" className="h-px" />

        {items.length > 0 && (
          <p className="mt-3 font-montserrat text-[11px] text-text-muted">
            Mostrando {items.length} de {total} {total === 1 ? singular : plural}
          </p>
        )}
      </div>
    </div>
  )
}
