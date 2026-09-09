import styles from './NodeStatusLabel.module.scss'
import type { NodeStatus } from '../../../stores/node/constants.ts'

import { isDefined } from '@wopjs/cast'
import { clsx } from 'clsx'
import { useTranslate } from 'val-i18n-react'
import { Progress } from '../../../../../ui/browser/progress.tsx'
import { NODE_STATUS } from '../../../stores/node/constants.ts'

export interface NodeStatusIconProps {
  status: NodeStatus
  progress?: number
  className?: string
  loaderSize?: number
}

export const NodeStatusIcon: React.FC<NodeStatusIconProps> = ({ status, progress, className, loaderSize = 14 }) => {
  switch (status) {
    case NODE_STATUS.Success: {
      return <i className={clsx(className, styles.success, 'i-codicon:check')} />
    }
    case NODE_STATUS.Error: {
      return <i className={clsx(className, styles.error, 'i-codicon:error')} />
    }
    case NODE_STATUS.Running: {
      return progress == null ? (
        <i className={clsx(className, styles.running, 'i-codicon:loading', 'open-flow-canvas-spin')} />
      ) : (
        <Progress
          className={clsx(className, styles.progress, 'pointer-events-none')}
          style={{ '--node-status-progress': `${Math.min(100, Math.max(0, progress))}%`, '--node-status-size': `${loaderSize}px` } as React.CSSProperties}
          value={progress}
        />
      )
    }
    case NODE_STATUS.Waiting: {
      return <i className={clsx(className, styles.waiting, 'i-carbon:time')} />
    }
  }
  return null
}

export interface NodeStatusContentProps {
  status: NodeStatus
  progress?: number
  combo?: number
}

export const NodeStatusContent: React.FC<NodeStatusContentProps> = ({ status, progress, combo = 0 }) => {
  const t = useTranslate()
  switch (status) {
    case NODE_STATUS.Success: {
      return (
        <span>
          {t('nodeStatus.success')}
          {combo > 1 ? ` \u{D7}${combo}` : ''}
        </span>
      )
    }
    case NODE_STATUS.Error: {
      return (
        <span>
          {t('nodeStatus.error')}
          {combo > 1 ? ` \u{D7}${combo}` : ''}
        </span>
      )
    }
    case NODE_STATUS.Running: {
      return (
        <span>
          {t('nodeStatus.running')}
          {isDefined(progress) && `(${Math.round(progress)}%)`}
        </span>
      )
    }
    case NODE_STATUS.Waiting: {
      return <span>{t('nodeStatus.waiting')}...</span>
    }
  }
  return null
}
