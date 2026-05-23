import * as React from 'react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { cn } from '@/lib/utils'

const numberControlClass = cn(
  'font-mono tabular-nums',
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
)

type NumberInputProps = Omit<React.ComponentProps<'input'>, 'type'> & {
  type?: 'number' | 'text'
  prefix?: React.ReactNode
  suffix?: React.ReactNode
  groupClassName?: string
  addonClassName?: string
}

function NumberInput({
  className,
  groupClassName,
  addonClassName,
  prefix,
  suffix,
  type = 'number',
  ...props
}: NumberInputProps) {
  return (
    <InputGroup className={cn('h-8', groupClassName)}>
      <InputGroupInput
        type={type}
        className={cn(numberControlClass, className)}
        {...props}
      />
      {prefix != null ? (
        <InputGroupAddon align="inline-start" className={addonClassName}>
          <InputGroupText className="font-mono text-sm">{prefix}</InputGroupText>
        </InputGroupAddon>
      ) : null}
      {suffix != null ? (
        <InputGroupAddon align="inline-end" className={addonClassName}>
          <InputGroupText className="font-mono text-sm">{suffix}</InputGroupText>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
}

export { NumberInput, numberControlClass }
