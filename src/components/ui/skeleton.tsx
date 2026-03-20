import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-[length:200%_100%] bg-gradient-to-r from-accent via-accent/50 to-accent animate-[shimmer_1.5s_ease-in-out_infinite] rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
