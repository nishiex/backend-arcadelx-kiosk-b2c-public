"use client"
import React from "react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"

interface ShinyButtonProps extends React.ComponentProps<typeof Button> {
  shimmerColor?: string
}

export function ShinyButton({ shimmerColor = "rgba(255,255,255,0.4)", className, children, ...props }: ShinyButtonProps) {
  return (
    <Button
      className={cn(
        "group relative overflow-hidden transition-all hover:shadow-[0_0_20px_rgba(var(--primary),0.3)]",
        className
      )}
      {...props}
    >
      <div className="absolute inset-0 flex h-full w-full justify-center [transform:skew(-12deg)_translateX(-150%)] group-hover:duration-1000 group-hover:[transform:skew(-12deg)_translateX(150%)]">
        <div className="relative h-full w-8 bg-white/20" />
      </div>
      <span className="relative z-10">{children}</span>
    </Button>
  )
}
