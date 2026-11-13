'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Bell, CalendarDays, Clock, ClipboardCheck, Copy, FileText, History, LayoutDashboard, LayoutPanelLeft, ListTodo, ShieldCheck, UserCog, Users, UsersRound } from 'lucide-react'
import type { SeccionMenu } from '@/lib/crm/permisos'

const ICONOS = {
  tablero: LayoutDashboard,
  solicitudes: FileText,
  contactos: UsersRound,
  validacion: ShieldCheck,
  duplicados: Copy,
  usuarios: Users,
  bitacora: History,
  personal: UserCog,
  asignaciones: ClipboardCheck,
  agenda: CalendarDays,
  tareas: ListTodo,
  avisos: Bell,
  reportes: BarChart3,
  turnos: Clock,
} as const

type Props = {
  items: SeccionMenu[]
  /** Contador de pendientes por ruta (opcional; las entregas siguientes lo usan). */
  contadores?: Record<string, number>
  /** Dirección ve además el enlace al Panel Admin. */
  mostrarPanelAdmin: boolean
}

export default function CrmNav({ items, contadores = {}, mostrarPanelAdmin }: Props) {
  const pathname = usePathname()

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-border bg-[#060b12]">
      {/* Marca centrada */}
      <div className="border-b border-border px-5 py-5 text-center">
        <p className="font-cinzel text-lg font-bold uppercase tracking-[0.35em] text-gold">CRM</p>
        <p className="mt-0.5 font-cinzel text-[10px] uppercase tracking-[0.3em] text-gold/50">Imperium Iuris</p>
      </div>

      <nav aria-label="Secciones del CRM" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {items.map(({ href, label, icono }) => {
          const Icono = ICONOS[icono]
          const activo = href === '/admin/crm' ? pathname === href : pathname.startsWith(href)
          const pendientes = contadores[href] ?? 0
          return (
            <Link
              key={href}
              href={href}
              aria-current={activo ? 'page' : undefined}
              className={`focus-gold flex items-center gap-3 rounded px-3 py-2.5 font-montserrat text-xs font-medium uppercase tracking-widest transition-colors ${
                activo ? 'bg-gold/10 text-gold' : 'text-text-muted hover:bg-white/5 hover:text-gold/80'
              }`}
            >
              <Icono size={15} className="shrink-0" aria-hidden="true" />
              <span className="flex-1">{label}</span>
              {pendientes > 0 && (
                <span className="font-montserrat text-[10px] tabular-nums text-gold">{pendientes}</span>
              )}
            </Link>
          )
        })}
      </nav>

      {mostrarPanelAdmin && (
        <div className="border-t border-border p-3">
          <Link
            href="/admin/agenda"
            className="focus-gold flex items-center gap-3 rounded px-3 py-2.5 font-montserrat text-xs font-medium uppercase tracking-widest text-text-muted transition-colors hover:bg-white/5 hover:text-gold/80"
          >
            <LayoutPanelLeft size={15} className="shrink-0" aria-hidden="true" />
            Panel Admin
          </Link>
        </div>
      )}
    </aside>
  )
}
