'use client'

import { createContext, use, useCallback, useMemo, useState } from 'react'

import type { Rol } from '@/lib/crm/roles'

type EditModeContextValue = {
  isAdmin: boolean
  /** Rol del CRM de la sesión (o null). Solo el rol: ningún otro dato de la sesión. */
  rolCrm: Rol | null
  editMode: boolean
  toggleEditMode: () => void
}

const EditModeContext = createContext<EditModeContextValue | null>(null)

export function EditModeProvider({
  isAdmin,
  rolCrm = null,
  children,
}: {
  isAdmin: boolean
  rolCrm?: Rol | null
  children: React.ReactNode
}) {
  const [editMode, setEditMode] = useState(false)
  const toggleEditMode = useCallback(() => setEditMode((v) => !v), [])

  const contextValue = useMemo(
    () => ({ isAdmin, rolCrm, editMode: isAdmin && editMode, toggleEditMode }),
    [isAdmin, rolCrm, editMode, toggleEditMode],
  )

  return (
    <EditModeContext.Provider value={contextValue}>
      {children}
    </EditModeContext.Provider>
  )
}

export function useEditMode(): EditModeContextValue {
  const ctx = use(EditModeContext)
  if (!ctx) throw new Error('useEditMode must be used inside <EditModeProvider>')
  return ctx
}
