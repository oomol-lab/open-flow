import type { FrontendStory } from './stories.tsx'

import { useState } from 'react'
import { Button } from '../../src/ui/browser/button.tsx'
import { Input } from '../../src/ui/browser/input.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../src/ui/browser/popover.tsx'

function Sample({ layout, initiallyOpen }: { layout: 'grid' | 'flex'; initiallyOpen: boolean }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <section className="min-h-64 min-w-0 space-y-3 rounded-lg border border-border p-4">
      <h3 className="text-xs font-medium">
        {layout} · {initiallyOpen ? 'Open on entry' : 'Closed on entry'}
      </h3>
      <div ref={setContainer} className={layout === 'grid' ? 'grid grid-cols-[minmax(0,1fr)_auto] gap-1' : 'flex gap-1'}>
        <Input aria-label={`${layout} ${initiallyOpen} field`} defaultValue="Field value" className="min-w-0 flex-1" />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={<Button variant="ghost" size="sm" />}>Options</PopoverTrigger>
          <PopoverContent container={container} align="end" className="w-auto">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Close menu
            </Button>
          </PopoverContent>
        </Popover>
      </div>
      <div className="border-t border-border pt-2 text-xs text-muted-foreground">This divider stays still when the menu opens.</div>
    </section>
  )
}

export const popupLayoutStory: FrontendStory = {
  id: 'popup-layout',
  group: 'Popup',
  title: 'Layout Stability',
  description: 'Locally mounted popovers in Grid and Flex rows. Opening a menu must not shift the field or the divider below it.',
  standalone: true,
  render: (_, dark) => (
    <div className="open-flow-theme grid grid-cols-2 gap-6 p-6" data-theme={dark ? 'dark' : 'light'}>
      {(['grid', 'flex'] as const).flatMap((layout) =>
        [false, true].map((initiallyOpen) => <Sample key={`${layout}-${initiallyOpen}`} layout={layout} initiallyOpen={initiallyOpen} />),
      )}
    </div>
  ),
}
