import { createContext, useContext } from 'react'

type GetPopupContainerFn = (triggerNode?: HTMLElement) => HTMLElement

export interface GetPopupContainer {
  /** The container whose scale and position follow the React Flow viewport. */
  readonly default: GetPopupContainerFn
  /** The top-level container with a fixed scale. */
  readonly static: GetPopupContainerFn
}

export const GetPopupContainerContext: React.Context<GetPopupContainer> = /*#__PURE__*/ createContext({
  default: () => document.body,
  static: () => document.body,
})

export function useGetPopupContainer(): GetPopupContainerFn {
  return useContext(GetPopupContainerContext).default
}

export function useGetStaticPopupContainer(): GetPopupContainerFn {
  return useContext(GetPopupContainerContext).static
}
