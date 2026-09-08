import type { BasicNodeProps } from './BasicNode.tsx'

import { BasicNode } from './BasicNode.tsx'

export interface CommentNodeProps extends BasicNodeProps {}

export function CommentNode(props: CommentNodeProps): React.ReactElement {
  return <BasicNode {...props} />
}
