"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "@/lib/utils"
import { useBackClosableOpen } from "@/lib/overlay-history"
import { followKeyboard, inSafariTab, keepIosFromScrolling } from "@/lib/keyboard-fit"

function Drawer({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  // Back closes the drawer first (see overlay-history).
  const [open, setOpen] = useBackClosableOpen(openProp, defaultOpen, onOpenChange)
  // vaul's iOS scroll lock scrolls the page to the top while a drawer is open
  // and back to where it was on every press inside it. iOS drops a tap whose
  // page scrolls under the finger, so from a scrolled page links and buttons in
  // a drawer did nothing. The dialog under vaul already locks the page scroll.
  // (vaul's flag is inverted: false turns its scroll lock off.)
  //
  // vaul's own keyboard handling is off too: it guesses whether the keyboard
  // is open by flipping a flag on each large viewport change and remembers the
  // drawer's first height for good, so a form whose next step appears while
  // the keyboard is up was left lifted by the keyboard's height, cut to the
  // old step's height. DrawerContent places itself from the viewport instead.
  return (
    <DrawerPrimitive.Root
      data-slot="drawer"
      disablePreventScroll={false}
      repositionInputs={false}
      {...props}
      open={open}
      onOpenChange={setOpen}
    />
  )
}

/**
 * Keeps a bottom drawer above the on-screen keyboard and below the top of the
 * screen: at `bottom: 0` the keyboard would cover it (see keyboard-fit).
 */
function fitAboveKeyboard(node: HTMLElement): () => void {
  return followKeyboard(node, (covered, viewport) => {
    if (node.getAttribute("data-vaul-drawer-direction") !== "bottom") return
    if (!covered) {
      node.style.removeProperty("bottom")
      node.style.removeProperty("max-height")
      node.style.removeProperty("padding-bottom")
      node.removeAttribute("data-keyboard-tab")
      return
    }
    node.style.bottom = `${covered}px`
    node.style.maxHeight = `calc(${viewport.height}px - max(env(safe-area-inset-top), 0.75rem))`
    // The keyboard covers the home indicator the padding keeps clear of. In a
    // Safari tab, Safari's floating address bar sits over the bottom of what
    // is left, and a tap there goes to Safari, so keep the sheet's content
    // above it.
    const tab = inSafariTab()
    node.style.paddingBottom = tab ? "3.75rem" : "0px"
    // That leaves a form's body too short to show more than the field being
    // typed in, and Safari's ⌄ / ⌃ keyboard arrows skip a field whose centre
    // isn't on screen (WebKit hit-tests it), so the whole sheet scrolls as one
    // instead (globals.css).
    node.toggleAttribute("data-keyboard-tab", tab)
  })
}

function DrawerTrigger({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

function DrawerClose({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-background/80",
        className
      )}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  size = "full",
  ref,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content> & {
  /** "content": a bottom drawer only as tall as what it holds (up to 90dvh),
   *  for short forms and confirmations. "full" (default) is a fixed 90dvh
   *  panel whose body fills it with `flex-1 min-h-0` and scrolls. */
  size?: "full" | "content"
}) {
  const contentRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
      if (!node) return
      const stopFitting = fitAboveKeyboard(node)
      const stopGuarding = keepIosFromScrolling(node)
      return () => {
        stopFitting()
        stopGuarding()
        if (typeof ref === "function") ref(null)
        else if (ref) ref.current = null
      }
    },
    [ref]
  )

  return (
    <DrawerPortal data-slot="drawer-portal">
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          "group/drawer-content bg-background fixed z-50 flex h-auto flex-col",
          // Same reasoning as the sheet: a drawer sits on a viewport edge, and
          // under `viewport-fit=cover` those edges are behind the phone's
          // status bar, Dynamic Island or home indicator. Zero everywhere a
          // device has no inset, so desktop and browser tabs are unchanged.
          "data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[80dvh] data-[vaul-drawer-direction=top]:rounded-b-lg data-[vaul-drawer-direction=top]:border-b data-[vaul-drawer-direction=top]:pt-[env(safe-area-inset-top)]",
          "data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:h-[90dvh] data-[vaul-drawer-direction=bottom]:max-h-[90dvh] data-[vaul-drawer-direction=bottom]:rounded-t-lg data-[vaul-drawer-direction=bottom]:border-t data-[vaul-drawer-direction=bottom]:pb-[env(safe-area-inset-bottom)]",
          "data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=right]:pt-[env(safe-area-inset-top)] data-[vaul-drawer-direction=right]:pb-[env(safe-area-inset-bottom)] data-[vaul-drawer-direction=right]:sm:max-w-sm",
          "data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=left]:pt-[env(safe-area-inset-top)] data-[vaul-drawer-direction=left]:pb-[env(safe-area-inset-bottom)] data-[vaul-drawer-direction=left]:sm:max-w-sm",
          size === "content" && "data-[vaul-drawer-direction=bottom]:h-auto",
          className
        )}
        ref={contentRef}
        {...props}
      >
        <div className="bg-muted mx-auto mt-4 hidden h-2 w-[100px] shrink-0 rounded-full group-data-[vaul-drawer-direction=bottom]/drawer-content:block" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center group-data-[vaul-drawer-direction=top]/drawer-content:text-center md:gap-1.5 md:text-left",
        className
      )}
      {...props}
    />
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      // A long release or file name must wrap rather than run past a phone's
      // edge, even inside a flex row.
      className={cn("text-foreground min-w-0 font-semibold [overflow-wrap:anywhere]", className)}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-muted-foreground min-w-0 text-sm [overflow-wrap:anywhere]", className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
