import type { BasicNodeProps } from './BasicNode.tsx'

import { BasicNode } from './BasicNode.tsx'

export interface ConditionNodeProps extends BasicNodeProps {}

export function ConditionNode(props: ConditionNodeProps): React.ReactElement {
  return <BasicNode {...props} />
}
