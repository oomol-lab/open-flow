import styles from './ValuePreview.module.scss'

import { collapseAllNested, JSONViewer } from '../../../../../ui/browser/json-viewer/index.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../../../../../ui/browser/popover.tsx'
import { ScrollArea } from '../../../../../ui/browser/scroll-area.tsx'
import { useGetStaticPopupContainer } from '../../ReactFlowContainer/useGetPopupContainer.ts'

export function ValuePreview({ name, value }: { readonly name: string; readonly value: unknown }) {
  const getContainer = useGetStaticPopupContainer()
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={200}
        closeDelay={150}
        render={<button type="button" className={`${styles.trigger} nodrag nopan nokey`} onClick={(event) => event.stopPropagation()} />}
      >
        {JSON.stringify(value)}
      </PopoverTrigger>
      <PopoverContent
        container={getContainer()}
        side="top"
        align="center"
        sideOffset={8}
        className={`${styles.popup} nodrag nopan nowheel nokey`}
        aria-label={name}
        data-canvas-control-scope
        onClick={(event) => event.stopPropagation()}
      >
        <ScrollArea className={styles.content}>
          <JSONViewer className={styles.json} data={value} shouldExpandNode={collapseAllNested} />
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
