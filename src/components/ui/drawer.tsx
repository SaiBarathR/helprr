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
  // The box fixed elements are placed in, measured rather than taken from
  // window.innerHeight: iOS briefly reports the visible height there while the
  // keyboard moves, and a drawer placed from that stayed behind the keyboard.
  const layout = document.createElement("div")
  layout.setAttribute("aria-hidden", "true")
  layout.style.cssText = "position:fixed;inset:0;visibility:hidden;pointer-events:none"
  document.body.appendChild(layout)
  let frame = 0
  let visibleHeight = 0
  const place = () => {
    frame = 0
    if (node.getAttribute("data-vaul-drawer-direction") !== "bottom") return
    // The part of the layout viewport the keyboard covers, under the visible
    // part. A pinch zoom shrinks the visual viewport too, but changes its
    // scale; a keyboard leaves it at 1.
    // (Unmeasured, as in tests without layout, it falls back to innerHeight.)
    const layoutBottom = layout.getBoundingClientRect().bottom || window.innerHeight
    const covered = viewport.scale > 1.01 ? 0 : Math.round(layoutBottom - viewport.height - viewport.offsetTop)
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
  // iOS can still be mid-way through the keyboard's move when it reports a
  // size; look again once it has settled.
  let settle: number[] = []
  const onResize = () => {
    schedule()
    settle.forEach((timer) => window.clearTimeout(timer))
    settle = [150, 400].map((ms) => window.setTimeout(schedule, ms))
  }
  viewport.addEventListener("resize", onResize)
  // iOS pans the visual viewport, or scrolls the page, to show a field the
  // keyboard would hide (also when an autocorrect suggestion is tapped).
  viewport.addEventListener("scroll", schedule)
  window.addEventListener("resize", onResize)
  window.addEventListener("scroll", schedule)
  place()
  return () => {
    viewport.removeEventListener("resize", onResize)
    viewport.removeEventListener("scroll", schedule)
    window.removeEventListener("resize", onResize)
    window.removeEventListener("scroll", schedule)
    settle.forEach((timer) => window.clearTimeout(timer))
    cancelAnimationFrame(frame)
    layout.remove()
  }
}

function isTextField(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement &&
      !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(target.type))
  )
}

function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

/**
 * Stops iOS scrolling the page to show a field in a drawer; fitAboveKeyboard
 * keeps the field in view instead. With the page scrolled under it, iOS drew
 * the fixed drawer lower than it measured, by as much as it had scrolled, so
 * the field and buttons ended up behind the keyboard. Only while a field in
 * the drawer has focus does a scroll go back to where the page was then:
 * opening and closing a drawer scrolls the page too (vaul holds it in place
 * under the drawer in Safari) and must be left alone.
 */
function keepIosFromScrolling(node: HTMLElement): () => void {
  if (!isIOS()) return () => {}
  let pinned: { x: number; y: number } | null = null
  let start: { x: number; y: number } | null = null
  // Safari only scrolls to a field it thinks is off screen.
  const hideFromSafari = (field: HTMLElement) => {
    field.style.transform = "translateY(-2000px)"
    requestAnimationFrame(() => {
      field.style.transform = ""
    })
  }
  const onTouchStart = (event: TouchEvent) => {
    const touch = event.changedTouches[0]
    start = touch ? { x: touch.clientX, y: touch.clientY } : null
  }
  const onTouchEnd = (event: TouchEvent) => {
    const field = event.target
    const touch = event.changedTouches[0]
    if (!isTextField(field) || field === document.activeElement || !start || !touch) return
    // A scroll that happens to end on a field is not a tap on it.
    if (Math.abs(touch.clientX - start.x) > 10 || Math.abs(touch.clientY - start.y) > 10) return
    // Tapped: focus it ourselves, hidden, so Safari has nothing to scroll to.
    event.preventDefault()
    hideFromSafari(field)
    field.focus()
  }
  const onFocusIn = (event: FocusEvent) => {
    if (!isTextField(event.target)) return
    pinned ??= { x: window.scrollX, y: window.scrollY }
    // Focus can also move another way, e.g. the keyboard's next and previous arrows.
    hideFromSafari(event.target)
  }
  const onFocusOut = (event: FocusEvent) => {
    if (!isTextField(event.relatedTarget) || !node.contains(event.relatedTarget)) pinned = null
  }
  const onScroll = () => {
    // A drawer closing with a field still focused lets go at once: vaul
    // scrolls the page back to where it was as the close starts.
    const field = document.activeElement
    if (node.getAttribute("data-state") !== "open" || !isTextField(field) || !node.contains(field)) pinned = null
    if (pinned && (window.scrollX !== pinned.x || window.scrollY !== pinned.y)) window.scrollTo(pinned.x, pinned.y)
  }
  node.addEventListener("touchstart", onTouchStart, { capture: true, passive: true })
  node.addEventListener("touchend", onTouchEnd, { capture: true, passive: false })
  node.addEventListener("focusin", onFocusIn, true)
  node.addEventListener("focusout", onFocusOut, true)
  window.addEventListener("scroll", onScroll)
  return () => {
    node.removeEventListener("touchstart", onTouchStart, true)
    node.removeEventListener("touchend", onTouchEnd, true)
    node.removeEventListener("focusin", onFocusIn, true)
    node.removeEventListener("focusout", onFocusOut, true)
    window.removeEventListener("scroll", onScroll)
  }
}

/**
 * Scrolls the drawer's body so the field being typed in sits near its top,
 * with what follows it (the next field, the button that sends the form) in
 * view above the keyboard rather than under it.
 */
function revealFocusedField(node: HTMLElement) {
  const field = document.activeElement
  if (!(field instanceof HTMLElement) || !node.contains(field)) return
  for (let box = field.parentElement; box && box !== node; box = box.parentElement) {
    if (box.scrollHeight <= box.clientHeight) continue
    const overflow = getComputedStyle(box).overflowY
    if (overflow !== "auto" && overflow !== "scroll") continue
    // Its label sits just above it.
    box.scrollTop += field.getBoundingClientRect().top - box.getBoundingClientRect().top - 40
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
