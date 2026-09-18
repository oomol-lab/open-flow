import type { ReactNode } from 'react'

/** Shared title and inset divider for selection menus. */
export function MenuHeader({ children }: { children: ReactNode }) {
  return (
    <>
      <div data-slot="menu-header" className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {children}
      </div>
      <div role="separator" className="pointer-events-none mx-2 my-1 h-px bg-border/50" />
    </>
  )
}
