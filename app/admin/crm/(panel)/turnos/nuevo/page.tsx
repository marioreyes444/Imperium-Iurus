import Link from 'next/link'
import TurnoForm from '@/components/crm/TurnoForm'
import { ACCIONES, personalDePagina } from '@/lib/crm/permisos'
import { abogadosActivos } from '@/lib/crm/horarios'

export const dynamic = 'force-dynamic'

export default async function NuevoTurnoPage() {
  await personalDePagina(ACCIONES['turnos.gestionar'])
  const abogados = await abogadosActivos().catch(() => [])

  return (
    <div className="space-y-8 px-6 pb-16 pt-8">
      <div className="border-b border-border pb-6">
        <Link href="/admin/crm/turnos" className="focus-gold font-montserrat text-[10px] uppercase tracking-widest text-text-muted hover:text-gold">← Turnos</Link>
        <h1 className="mt-2 font-cinzel text-3xl font-bold uppercase tracking-wider text-gold">Nuevo turno</h1>
      </div>
      <TurnoForm abogados={abogados} volverHref="/admin/crm/turnos" />
    </div>
  )
}
