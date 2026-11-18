'use client'

import Link from 'next/link'
import { useLinkStatus } from 'next/link'
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'

// Next.js keeps the current page on screen until the next route is ready. A
// link's pending state is the only immediate signal available for that gap, so
// we collect it from every link and show one shared progress bar at the top.
const SetLinkPending = createContext<((id: string, pending: boolean) => void) | null>(null)

export function RouteTransitionProvider({ children }: { children: ReactNode }) {
  const [pendingLinks, setPendingLinks] = useState<ReadonlySet<string>>(() => new Set())

  const setLinkPending = useCallback((id: string, pending: boolean) => {
    setPendingLinks((current) => {
      if (current.has(id) === pending) return current
      const next = new Set(current)
      if (pending) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const value = useMemo(() => setLinkPending, [setLinkPending])

  return (
    <SetLinkPending.Provider value={value}>
      {pendingLinks.size > 0 && <div className="route-progress" role="progressbar" aria-label="Loading the next page"><span /></div>}
      {children}
    </SetLinkPending.Provider>
  )
}

function LinkStatusSignal() {
  // Must live inside <Link> for useLinkStatus to see the pending navigation.
  const { pending } = useLinkStatus()
  const setLinkPending = useContext(SetLinkPending)
  const id = useId()

  useEffect(() => {
    if (!pending || !setLinkPending) return
    setLinkPending(id, true)
    return () => setLinkPending(id, false)
  }, [id, pending, setLinkPending])

  return null
}

export function TransitionLink({ children, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props}>{children}<LinkStatusSignal /></Link>
}
