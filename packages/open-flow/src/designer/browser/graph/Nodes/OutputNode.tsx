import type { BasicNodeProps } from './BasicNode.tsx'

import { BasicNode } from './BasicNode.tsx'

export interface OutputNodeProps extends BasicNodeProps {}

export function OutputNode(props: OutputNodeProps): React.ReactElement {
  return <BasicNode {...props} />
}
