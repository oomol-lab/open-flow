import type { useState } from 'react'
import type { HandleName } from '../../../../schema/index.ts'

import { createContext, useContext } from 'react'
import { noop } from '../../base/trivial.ts'

export type InputHandleDnd = ReturnType<typeof useState<HandleName | undefined>>

export const InputHandleDndContext: React.Context<InputHandleDnd> = /*#__PURE__*/ createContext<InputHandleDnd>([undefined, noop])

export function useInputHandleDnd(): InputHandleDnd {
  return useContext(InputHandleDndContext)
}
