"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useIsMobile } from "@/hooks/use-is-mobile"

const Toaster = ({ ...props }: ToasterProps) => {
  // On a phone (Sonner's own breakpoint, 600px and under) toasts come from the
  // top, as iOS banners do: at the bottom they sat over the buttons of every
  // bottom sheet (Copy/Download, Make link, Create) while they showed.
  const phone = useIsMobile(600)
  return (
    <Sonner
      className="toaster group"
      position={phone ? "top-center" : "bottom-right"}
      closeButton
      // Sonner's defaults (24px, 16px on a phone) put toasts over the bottom tab
      // bar and the home indicator; keep them above both, and above a
      // floating action bar or the now-playing bar while one is up. On a
      // landscape iPhone, keep them off the notch and rounded corners too.
      offset={{
        bottom: "calc(var(--footer-height) + var(--player-bar-height, 0px) + var(--floating-bar-clearance, 0px) + 24px)",
        left: "calc(env(safe-area-inset-left, 0px) + 24px)",
        right: "calc(env(safe-area-inset-right, 0px) + 24px)",
      }}
      mobileOffset={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
