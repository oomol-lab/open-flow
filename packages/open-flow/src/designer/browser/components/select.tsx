import styles from './select.module.scss'
import type { TooltipRef } from '@rc-component/tooltip'
import type {
  ClearIndicatorProps,
  DropdownIndicatorProps,
  GroupBase,
  GroupProps,
  MenuPlacement,
  MenuPosition,
  MenuProps,
  OnChangeValue,
  OptionsOrGroups,
  Props,
  PropsValue,
  SelectInstance,
  Theme,
  ValueContainerProps,
} from 'react-select'
import type { ReadonlyVal } from 'value-enhancer'

import Tooltip from '@rc-component/tooltip'
import { clsx } from 'clsx'
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactSelect, { components, defaultTheme } from 'react-select'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { stopPropagation } from '../base/dom.ts'
import { forwardRef2 } from '../base/react.ts'
import { useGetStaticPopupContainer } from '../graph/ReactFlowContainer/useGetPopupContainer.ts'
import { DesignerIcon } from '../icons/DesignerIcon.tsx'
import { CssWrapper } from './cssWrapper.tsx'

interface ExtraProps {
  readonly keyboardNavigation$?: ReadonlyVal<boolean>
  readonly labelInMenu?: string
  readonly searching$?: ReadonlyVal<boolean>
}

export interface DesignerOption {
  readonly icon?: string | React.ReactNode
  readonly label?: string
  readonly value?: string
  readonly isDisabled?: boolean
  readonly group?: { readonly label: string; readonly value?: string }
}

export interface DesignerOptionGroup<Option extends DesignerOption = DesignerOption> extends GroupBase<Option> {
  readonly value?: string
  readonly icon?: string | React.ReactNode
}

export interface DesignerComboboxProps<
  Option extends DesignerOption = DesignerOption,
  IsMulti extends boolean = false,
  Group extends DesignerOptionGroup<Option> = DesignerOptionGroup<Option>,
> {
  id?: string
  inputId?: string
  className?: string
  placeholder?: string
  disabled?: boolean
  variant?: 'default' | 'danger'
  isMulti?: IsMulti
  isClearable?: boolean
  menuPosition?: MenuPosition
  menuPlacement?: MenuPlacement
  defaultOpen?: boolean
  defaultValue?: PropsValue<Option>
  value?: PropsValue<Option>
  options?: OptionsOrGroups<Option, Group>
  onChange?: (value: OnChangeValue<Option, IsMulti>) => void
  onClose?: () => void
  onOpen?: () => void
  labelInMenu?: string
  maxMenuHeight?: number
  capitalize?: boolean
  isSuffix?: boolean
}

function DropdownIndicator<Option extends DesignerOption = DesignerOption, IsMulti extends boolean = false>(props: DropdownIndicatorProps<Option, IsMulti>) {
  return (
    <components.DropdownIndicator {...props}>
      <i className="i-codicon:chevron-down" />
    </components.DropdownIndicator>
  )
}

function ClearIndicator<Option extends DesignerOption = DesignerOption, IsMulti extends boolean = false>(props: ClearIndicatorProps<Option, IsMulti>) {
  return (
    <components.ClearIndicator {...props}>
      <i className="i-codicon:close" />
    </components.ClearIndicator>
  )
}

function Menu<Option extends DesignerOption = DesignerOption>(props: MenuProps<Option>) {
  const selectProps = props.selectProps as ExtraProps
  return (
    <components.Menu {...props} className={clsx(props.className, 'nowheel')}>
      {props.children}
      {selectProps.labelInMenu && (
        <div className={styles.labelInMenu} title={selectProps.labelInMenu}>
          {selectProps.labelInMenu}
        </div>
      )}
    </components.Menu>
  )
}

function ValueContainer<Option extends DesignerOption = DesignerOption>(props: ValueContainerProps<Option>) {
  const t = useTranslate()
  if (props.isMulti && props.getValue().length > 1) {
    const [, input] = props.children as [React.ReactNode[], React.ReactNode]
    return (
      <components.ValueContainer {...props}>
        <div className={styles.multiValue}>
          <div className={styles.label}>{t('components.numOptions', { count: props.getValue().length })}</div>
        </div>
        {input}
      </components.ValueContainer>
    )
  }
  return <components.ValueContainer {...props}>{props.children}</components.ValueContainer>
}

function Group<
  Option extends DesignerOption = DesignerOption,
  IsMulti extends boolean = false,
  Group extends DesignerOptionGroup<Option> = DesignerOptionGroup<Option>,
>(props: GroupProps<Option, IsMulti, Group>) {
  const { keyboardNavigation$, searching$ } = props.selectProps as ExtraProps
  const keyboardNavigation = useVal(keyboardNavigation$)
  const searching = useVal(searching$)
  const getPopupContainer = useGetStaticPopupContainer()
  const popupRef = useRef<TooltipRef>(null)
  const popupContainerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const [popupScale, setPopupScale] = useState(1)
  const groupClassName = props.cx({ group: true }, props.getClassNames('group', props), props.className)
  useLayoutEffect(() => {
    const holder = document.createElement('div')
    holder.className = styles.popupScaleContainer
    getPopupContainer().appendChild(holder)
    popupContainerRef.current = holder
    return () => {
      popupContainerRef.current = null
      holder.remove()
    }
  }, [getPopupContainer])
  useLayoutEffect(() => {
    const holder = popupContainerRef.current
    if (holder) holder.style.transform = `scale(${popupScale})`
    popupRef.current?.forceAlign()
  }, [popupScale])
  if (keyboardNavigation || searching) {
    return (
      <div className={groupClassName} {...props.innerProps}>
        <div className={styles.groupLabel}>
          {props.data.icon && <span className={styles.icon}>{renderIcon(props.data.icon)}</span>}
          <span className={styles.label}>{props.data.label}</span>
        </div>
        <div className={styles.grouped}>{props.children}</div>
      </div>
    )
  }
  return (
    <Tooltip
      ref={popupRef}
      align={{ offset: [-1, 0], points: ['tl', 'tr'] }}
      classNames={{ root: styles.menuPopup }}
      destroyOnHidden
      getTooltipContainer={() => popupContainerRef.current || getPopupContainer()}
      mouseEnterDelay={0.1}
      mouseLeaveDelay={0.1}
      onVisibleChange={(visible) => {
        const trigger = triggerRef.current
        if (visible && trigger && trigger.offsetWidth > 0) setPopupScale(trigger.getBoundingClientRect().width / trigger.offsetWidth)
      }}
      overlay={
        <div
          className={styles.menuBody}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDown={stopPropagation}
        >
          {props.children}
        </div>
      }
      placement="rightTop"
      showArrow={false}
      trigger={['hover', 'click']}
    >
      <div ref={triggerRef} className={clsx(groupClassName, styles.contextMenu)} {...props.innerProps}>
        {props.label}
      </div>
    </Tooltip>
  )
}

function formatOptionLabel<Option extends DesignerOption = DesignerOption>(option: Option) {
  return (
    <div className={styles.value} title={option.label || option.value}>
      {option.icon && <span className={styles.icon}>{renderIcon(option.icon)}</span>}
      <span className={styles.label}>{option.label || option.value}</span>
    </div>
  )
}

function formatGroupLabel<Option extends DesignerOption = DesignerOption>(group: DesignerOptionGroup<Option>) {
  return (
    <div className={styles.group}>
      {group.icon && <span className={styles.icon}>{renderIcon(group.icon)}</span>}
      <span className={styles.label}>{group.label}</span>
      <i className="i-codicon:chevron-right" />
    </div>
  )
}

const customTheme: Theme = { ...defaultTheme, spacing: { ...defaultTheme.spacing, controlHeight: 22 } }
const customComponents = { DropdownIndicator, ClearIndicator, Menu, ValueContainer, Group }
const customStyles = { menu: (base: {}) => ({ ...base, width: 'var(--menu-width)' }) }

function renderIcon(icon: React.ReactNode) {
  if (typeof icon === 'string') return icon.startsWith('i-') ? <i className={icon} /> : <DesignerIcon src={icon} />
  return icon
}

interface FilterOptionOption<Option> {
  readonly label: string
  readonly value: string
  readonly data: Option
}

function matchSubstring<Option extends DesignerOption = DesignerOption>(option: FilterOptionOption<Option>, input: string): boolean {
  input = input.trim().toLowerCase()
  return (
    (option.data.group?.label || '').toLowerCase().includes(input) ||
    (option.data.group?.value || '').toLowerCase().includes(input) ||
    (option.label || '').toLowerCase().includes(input) ||
    (option.value || '').toLowerCase().includes(input)
  )
}

export const DesignerCombobox: <Option extends DesignerOption = DesignerOption, IsMulti extends boolean = false>(
  props: DesignerComboboxProps<Option, IsMulti> & React.RefAttributes<HTMLInputElement>,
) => React.ReactElement | null = /*#__PURE__*/ forwardRef2(function DesignerCombobox<
  Option extends DesignerOption = DesignerOption,
  IsMulti extends boolean = false,
>(props: DesignerComboboxProps<Option, IsMulti>, ref?: React.Ref<HTMLInputElement>) {
  const t = useTranslate()
  const [keyboardNavigation$] = useState(() => val(false))
  const [searching$] = useState(() => val(false))
  const innerRef = useRef<SelectInstance<Option, IsMulti>>(null)
  useImperativeHandle(ref, () => innerRef.current!.inputRef!, [])
  const options = useMemo(() => {
    if (props.options?.some((entry) => 'options' in entry))
      return props.options.map((entry) =>
        'options' in entry ? { ...entry, options: entry.options.map((option) => ({ ...option, group: { label: entry.label, value: entry.value } })) } : entry,
      )
    return props.options
  }, [props.options])
  const [menuWidth, setMenuWidth] = useState(0)
  useEffect(() => {
    const control = innerRef.current?.controlRef
    if (!control) return
    const observer = new ResizeObserver((entries) => setMenuWidth(entries[0]?.borderBoxSize[0]?.inlineSize || control.clientWidth))
    observer.observe(control)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (props.defaultOpen) innerRef.current?.focus()
  }, [props.defaultOpen])
  const ReactSelectEx = ReactSelect as React.FC<
    Props<Option, IsMulti, DesignerOptionGroup<Option>> & ExtraProps & { ref: React.Ref<SelectInstance<Option, IsMulti>> }
  >
  return (
    <CssWrapper css={{ '--menu-width': `${menuWidth}px` }}>
      <ReactSelectEx
        id={props.id}
        inputId={props.inputId}
        ref={innerRef}
        defaultValue={props.defaultValue}
        value={props.value}
        options={options}
        onChange={props.onChange}
        onMenuClose={() => {
          keyboardNavigation$.set(false)
          props.onClose?.()
        }}
        onMenuOpen={props.onOpen}
        isDisabled={props.disabled}
        isMulti={props.isMulti}
        defaultMenuIsOpen={props.defaultOpen}
        isClearable={props.isClearable}
        tabSelectsValue={false}
        closeMenuOnSelect={!props.isMulti}
        blurInputOnSelect={!props.isMulti}
        openMenuOnFocus
        captureMenuScroll
        hideSelectedOptions={false}
        filterOption={matchSubstring}
        menuPosition={props.menuPosition}
        menuPlacement={props.menuPlacement}
        className={clsx(
          'react-select-container',
          props.variant === 'danger' && styles.danger,
          props.capitalize && styles.capitalize,
          props.isSuffix && styles.isSuffix,
          props.className,
        )}
        classNamePrefix="react-select"
        unstyled
        placeholder={props.placeholder ?? null}
        noOptionsMessage={() => t('components.noMatching')}
        theme={customTheme}
        styles={customStyles}
        components={customComponents}
        labelInMenu={props.labelInMenu}
        maxMenuHeight={props.maxMenuHeight ?? 190}
        formatOptionLabel={formatOptionLabel}
        formatGroupLabel={formatGroupLabel}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp'].includes(event.key)) keyboardNavigation$.set(true)
          stopPropagation(event)
        }}
        keyboardNavigation$={keyboardNavigation$}
        searching$={searching$}
        onInputChange={(value: string) => searching$.set(!!value)}
      />
    </CssWrapper>
  )
})
