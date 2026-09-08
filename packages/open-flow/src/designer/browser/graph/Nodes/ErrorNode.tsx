import type { BasicNodeProps } from './BasicNode.tsx'

import { BasicNode } from './BasicNode.tsx'

export interface ErrorNodeProps extends BasicNodeProps {}

export function ErrorNode(props: ErrorNodeProps): React.ReactElement {
  return <BasicNode {...props} />
}
