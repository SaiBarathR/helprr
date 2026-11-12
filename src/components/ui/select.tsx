"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useSafeAreaPadding } from "@/lib/hooks/use-safe-area-padding"

// Opens the list from the trigger once a phone keyboard has closed.
const OpenSelect = React.createContext<(() => void) | null>(null)

function Select({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  // Held here unless the caller controls it, so the trigger can open the list later.
  const [ownOpen, setOwnOpen] = React.useState(defaultOpen)
  const open = openProp ?? ownOpen
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (openProp === undefined) setOwnOpen(next)
      onOpenChange?.(next)
    },
    [openProp, onOpenChange]
  )
  const openList = React.useCallback(() => setOpen(true), [setOpen])
  return (
    <OpenSelect.Provider value={openList}>
      <SelectPrimitive.Root data-slot="select" open={open} onOpenChange={setOpen} {...props} />
    </OpenSelect.Provider>
  )
}

/**
 * True while an on-screen keyboard covers part of the window. A pinch zoom
 * shrinks the visual viewport too, but changes its scale; a keyboard leaves it at 1.
 */
function keyboardIsOpen() {
  const viewport = window.visualViewport
  return !!viewport && viewport.scale <= 1.01 && window.innerHeight - viewport.height > 80
}

function isTextField(element: Element | null) {
  return (
    element instanceof HTMLElement &&
    (element.isContentEditable ||
      element.matches("textarea, input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=reset])"))
  )
}

/**
 * Opens the list once the keyboard has closed and the window has stopped
 * resizing (or after 800 ms) — unless by then the select is gone or disabled,
 * or another field has been tapped and has the keyboard.
 */
function openAfterKeyboardCloses(trigger: HTMLButtonElement, openList: () => void) {
  const viewport = window.visualViewport
  let settle = 0
  const finish = () => {
    viewport?.removeEventListener("resize", check)
    window.clearTimeout(settle)
    window.clearTimeout(fallback)
    if (trigger.isConnected && !trigger.disabled && !isTextField(document.activeElement)) openList()
  }
  const check = () => {
    window.clearTimeout(settle)
    if (!keyboardIsOpen()) settle = window.setTimeout(finish, 150)
  }
  const fallback = window.setTimeout(finish, 800)
  viewport?.addEventListener("resize", check)
  check()
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  onClick,
  onPointerDown,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  const openList = React.useContext(OpenSelect)
  const pointerType = React.useRef("")
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      onPointerDown={(event) => {
        pointerType.current = event.pointerType
        onPointerDown?.(event)
      }}
      onClick={(event) => {
        onClick?.(event)
        // A mouse opens the list on press; this is for a tap with the keyboard up.
        if (event.defaultPrevented || !openList || pointerType.current === "mouse" || !keyboardIsOpen()) return
        // A tap opens the list, and the list closes on any window resize, so
        // the keyboard closing a moment later would make it flash and vanish.
        // Close the keyboard first and open the list once the screen settles.
        event.preventDefault()
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        openAfterKeyboardCloses(event.currentTarget, openList)
      }}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

// Popper, not item-aligned: item-aligned lays the whole list over the trigger
// and lets it run past the screen edge, where a phone can neither see nor
// scroll to the options.
function SelectContent({
  className,
  children,
  position = "popper",
  align = "center",
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const padding = useSafeAreaPadding(collisionPadding)
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        align={align}
        collisionPadding={padding}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
