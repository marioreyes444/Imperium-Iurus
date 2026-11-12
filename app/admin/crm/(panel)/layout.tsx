import { redirect } from 'next/navigation'
import CrmNav from '@/components/crm/CrmNav'
import CrmTopBar from '@/components/crm/CrmTopBar'
import BotonSalir from '@/components/crm/BotonSalir'
import { getSesionCrm, menuDe } from '@/lib/crm/permisos'
import { ROL_LABEL } from '@/lib/crm/roles'
import { contadoresMenu } from '@/lib/crm/contadores'

export const dynamic = 'force-dynamic'

function Aviso({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-primary px-6">
      <div className="max-w-md border border-border bg-card-bg p-8 text-center">
        <h1 className="font-cinzel text-lg uppercase tracking-widest text-gold">{titulo}</h1>
        <p className="mt-3 font-montserrat text-xs leading-relaxed text-text-muted">{texto}</p>
        <div className="mt-6 flex justify-center"><BotonSalir /></div>
      </div>
    </div>
  )
}

/** Armazón del CRM (CrmNav + CrmTopBar). La sesión y la ficha activa se comprueban en cada petición. */
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const sesion = await getSesionCrm()

  if (sesion.estado === 'sin_sesion') redirect('/admin/login?redirect=/admin/crm')
  if (sesion.estado === 'no_disponible') {
    return (
      <Aviso
        titulo="CRM no disponible"
        texto="El módulo todavía no está disponible en este entorno. Avisa al responsable del proyecto."
      />
    )
  }
  if (sesion.estado === 'sin_acceso') {
    return (
      <Aviso
        titulo="Sin acceso al CRM"
        texto="Tu cuenta no tiene una ficha activa en el CRM. Si crees que es un error, pide a Dirección que la revise."
      />
    )
  }

  const { personal } = sesion
  const contadores = await contadoresMenu(personal)
  return (
    <div className="flex min-h-screen bg-primary">
      <CrmNav items={menuDe(personal.rol)} contadores={contadores} mostrarPanelAdmin={personal.rol === 'direccion'} />
      <div className="ml-56 min-w-0 flex-1">
        <CrmTopBar nombre={`${personal.nombres} ${personal.apellidos}`} rolEtiqueta={ROL_LABEL[personal.rol]} />
        <main>{children}</main>
      </div>
    </div>
  )
}
