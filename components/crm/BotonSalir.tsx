'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

export default function BotonSalir({ compacto = false }: { compacto?: boolean }) {
  const router = useRouter()

  async function salir() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/admin/login')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={salir}
      className="focus-gold flex items-center gap-2 rounded px-2 py-1.5 font-montserrat text-[10px] font-medium uppercase tracking-widest text-text-muted transition-colors hover:bg-red-950/40 hover:text-red-400"
    >
      <LogOut size={14} className="shrink-0" aria-hidden="true" />
      {compacto ? <span className="sr-only">Cerrar sesión</span> : <span>Salir</span>}
    </button>
  )
}
