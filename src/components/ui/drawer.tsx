"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "@/lib/utils"

function Drawer({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
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
    />
  )
}

/**
 * Keeps a bottom drawer above the on-screen keyboard and below the top of the
 * screen. iOS and Android Chrome shrink only the visual viewport for the
 * keyboard; the layout viewport the drawer is fixed to stays full height, so
 * at `bottom: 0` the keyboard would cover it. Every change is worked out from
 * the viewport as it is now, so once the keyboard closes the drawer is back
 * on its own classes, whatever happened while it was open.
 */
function fitAboveKeyboard(node: HTMLElement): () => void {
  const viewport = window.visualViewport
  if (!viewport) return () => {}
  let frame = 0
  let visibleHeight = 0
  const place = () => {
    frame = 0
    if (node.getAttribute("data-vaul-drawer-direction") !== "bottom") return
    // The part of the layout viewport the keyboard covers, under the visible
    // part. A pinch zoom shrinks the visual viewport too, but changes its
    // scale; a keyboard leaves it at 1.
    const covered = viewport.scale > 1.01 ? 0 : Math.round(window.innerHeight - viewport.height - viewport.offsetTop)
    if (covered < 1) {
      node.style.removeProperty("bottom")
      node.style.removeProperty("max-height")
      node.style.removeProperty("padding-bottom")
      visibleHeight = 0
      return
    }
    node.style.bottom = `${covered}px`
    node.style.maxHeight = `calc(${viewport.height}px - max(env(safe-area-inset-top), 0.75rem))`
    // The keyboard covers the home indicator the padding keeps clear of.
    node.style.paddingBottom = "0px"
    // Only when the keyboard opens or changes size, not on every iOS pan, so
    // a body scrolled away from the field while typing stays where it is.
    if (viewport.height !== visibleHeight) revealFocusedField(node)
    visibleHeight = viewport.height
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(place)
  }
  viewport.addEventListener("resize", schedule)
  // iOS pans the visual viewport to show a field the keyboard would hide.
  viewport.addEventListener("scroll", schedule)
  place()
  return () => {
    viewport.removeEventListener("resize", schedule)
    viewport.removeEventListener("scroll", schedule)
    cancelAnimationFrame(frame)
  }
}

/** Scrolls the drawer's body so the field being typed in shows above the keyboard. */
function revealFocusedField(node: HTMLElement) {
  const field = document.activeElement
  if (!(field instanceof HTMLElement) || !node.contains(field)) return
  for (let box = field.parentElement; box && box !== node; box = box.parentElement) {
    if (box.scrollHeight <= box.clientHeight) continue
    const overflow = getComputedStyle(box).overflowY
    if (overflow !== "auto" && overflow !== "scroll") continue
    const fieldRect = field.getBoundingClientRect()
    const boxRect = box.getBoundingClientRect()
    if (fieldRect.bottom > boxRect.bottom) box.scrollTop += fieldRect.bottom - boxRect.bottom + 12
    else if (fieldRect.top < boxRect.top) box.scrollTop -= boxRect.top - fieldRect.top + 12
    return
  }
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
      const stop = fitAboveKeyboard(node)
      return () => {
        stop()
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
