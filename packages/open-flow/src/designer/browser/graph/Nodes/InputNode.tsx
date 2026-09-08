import type { BasicNodeProps } from './BasicNode.tsx'

import { BasicNode } from './BasicNode.tsx'

export interface InputNodeProps extends BasicNodeProps {}

export function InputNode(props: InputNodeProps): React.ReactElement {
  return <BasicNode {...props} />
}
