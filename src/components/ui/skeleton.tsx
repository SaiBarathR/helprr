import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        // Subtle warm shimmer — matches projector booth tone, not generic gray.
        "bg-[length:200%_100%] bg-gradient-to-r from-muted/60 via-muted to-muted/60 animate-[shimmer_2s_ease-in-out_infinite] rounded-md",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
