"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "rounded-lg p-[3px] group-data-[orientation=horizontal]/tabs:h-9 data-[variant=line]:rounded-none group/tabs-list text-muted-foreground inline-flex w-fit items-center justify-center group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
        // A page's section switch: full width on phones, its own width from sm up.
        // Starts at the left, so a strip that scrolls sideways can reach its first tab.
        segmented: "flex w-full justify-start gap-0.5 bg-muted/50 p-0.5 sm:w-fit",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  onPointerDown,
  onFocus,
  onKeyDown,
  onBlur,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  // Radix focuses the tab from its own mousedown handler, and that script
  // focus matches :focus-visible after a tap. Focus that follows a press on
  // this tab is marked, so the ring (focus-key:) shows for keyboard focus
  // only. A press that never focuses (a right-click, a scroll) marks nothing.
  const pressedAt = React.useRef(0)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      onPointerDown={(event) => {
        pressedAt.current = Date.now()
        onPointerDown?.(event)
      }}
      onFocus={(event) => {
        // On touch the focus comes after the whole tap, so allow a moment.
        if (Date.now() - pressedAt.current < 1000) event.currentTarget.dataset.pointerFocus = ""
        onFocus?.(event)
      }}
      onKeyDown={(event) => {
        delete event.currentTarget.dataset.pointerFocus
        onKeyDown?.(event)
      }}
      onBlur={(event) => {
        delete event.currentTarget.dataset.pointerFocus
        onBlur?.(event)
      }}
      className={cn(
        "focus-key:border-ring focus-key:ring-ring/50 focus-key:outline-ring data-[pointer-focus]:outline-none text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start focus-key:ring-[3px] focus-key:outline-1 disabled:pointer-events-none disabled:opacity-50 group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent",
        "group-data-[variant=segmented]/tabs-list:py-1.5 group-data-[variant=segmented]/tabs-list:text-xs group-data-[variant=segmented]/tabs-list:data-[state=active]:shadow-sm sm:group-data-[variant=segmented]/tabs-list:flex-none sm:group-data-[variant=segmented]/tabs-list:px-3",
        "data-[state=active]:bg-background dark:data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 data-[state=active]:text-foreground",
        // A 44px-tall hit area on ::before (::after draws the line indicator);
        // the width stays, since tabs sit edge to edge.
        "before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']",
        "after:bg-foreground after:absolute after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
