import type { BasicNodeProps } from './BasicNode.tsx'

import { BasicNode } from './BasicNode.tsx'

export interface SubflowNodeProps extends BasicNodeProps {}

export function SubflowNode(props: SubflowNodeProps): React.ReactElement {
  return <BasicNode {...props} />
}
