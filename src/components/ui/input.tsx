import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Refined: hairline border, amber focus ring, tabular nums for numeric inputs.
        "file:text-foreground placeholder:text-muted-foreground/60 selection:bg-primary/30 selection:text-foreground",
        "h-10 w-full min-w-0 rounded-md border border-input bg-background/40 backdrop-blur-sm px-3 py-1.5 text-[15px] md:text-sm",
        "shadow-[inset_0_1px_0_0_color-mix(in_oklch,var(--foreground),transparent_94%)] transition-[color,box-shadow,border-color] outline-none",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:bg-background/70",
        "aria-invalid:ring-destructive/30 aria-invalid:border-destructive",
        "[&[type=number]]:tabular-nums",
        className
      )}
      {...props}
    />
  )
}

export { Input }
