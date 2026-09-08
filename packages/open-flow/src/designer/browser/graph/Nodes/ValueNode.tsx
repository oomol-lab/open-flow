import type { BasicNodeProps } from './BasicNode.tsx'

import { BasicNode } from './BasicNode.tsx'

export interface ValueNodeProps extends BasicNodeProps {}

export function ValueNode(props: ValueNodeProps): React.ReactElement {
  return <BasicNode {...props} />
}
