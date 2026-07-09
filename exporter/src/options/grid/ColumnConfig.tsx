import { For } from 'solid-js'
import * as Popover from '@kobalte/core/popover'
import * as SwitchPrimitive from '@kobalte/core/switch'

import type { ColumnDef } from './types'

interface ColumnConfigProps {
  columns: ColumnDef[]
  visibility: Record<string, boolean>
  onToggle: (columnKey: string) => void
}

export default function ColumnConfig(props: ColumnConfigProps) {
  const visibleCount = () =>
    Object.values(props.visibility).filter(Boolean).length

  return (
    <Popover.Root>
      <Popover.Trigger class="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50">
        <svg
          class="h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"
          />
        </svg>
        Columns
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-50 w-56 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Toggle columns
          </div>
          <div class="flex flex-col gap-1">
            <For each={props.columns}>
              {(col) => {
                const isVisible = () => props.visibility[col.key] ?? true
                const isDisabled = () =>
                  isVisible() && visibleCount() <= 1

                return (
                  <SwitchPrimitive.Root
                    class="flex items-center justify-between rounded px-2 py-1.5 hover:bg-gray-50"
                    checked={isVisible()}
                    disabled={isDisabled()}
                    onChange={() => props.onToggle(col.key)}
                  >
                    <SwitchPrimitive.Label class="text-sm text-gray-700 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50">
                      {col.label}
                    </SwitchPrimitive.Label>
                    <SwitchPrimitive.Input class="[&:focus-visible+div]:ring-2 [&:focus-visible+div]:ring-ring [&:focus-visible+div]:ring-offset-2" />
                    <SwitchPrimitive.Control class="inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-gray-200 transition-colors data-[checked]:bg-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50">
                      <SwitchPrimitive.Thumb class="pointer-events-none block h-4 w-4 translate-x-0 rounded-full bg-white shadow-sm transition-transform data-[checked]:translate-x-4" />
                    </SwitchPrimitive.Control>
                  </SwitchPrimitive.Root>
                )
              }}
            </For>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
