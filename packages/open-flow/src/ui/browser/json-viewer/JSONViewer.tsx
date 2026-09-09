import styles from './JSONViewer.module.scss'

import { clsx } from 'clsx'
import { memo } from 'react'
import { DataRender } from './DataRender.tsx'

export interface JSONViewerProps {
  className?: string
  data: any
  disableTopLevelExpand?: boolean
  shouldExpandNode?: (level: number, value: any, field?: string | number) => boolean
}

export const collapseAllNested = (level: number): boolean => level < 1
const collapseTopLevel = (level: number): boolean => level === 1

export { collapseTopLevel }

export const JSONViewer: React.FC<JSONViewerProps> = /* @__PURE__ */ memo(
  ({ className, data, disableTopLevelExpand, shouldExpandNode = collapseTopLevel }: JSONViewerProps) => {
    return (
      <div className={clsx(disableTopLevelExpand ? styles['container-hide-top'] : styles['container'], className)}>
        <DataRender value={data} lastElement level={0} shouldExpandNode={shouldExpandNode} clickToExpandNode stringTruncateLength={300} groupSize={50} />
      </div>
    )
  },
)
