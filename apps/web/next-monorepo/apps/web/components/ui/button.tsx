"use client"

import React from "react"

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "ghost" }

export function Button({ className = "", variant = "default", children, ...props }: Props) {
  const base = "inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm font-medium"
  const v = variant === "ghost" ? "bg-transparent hover:bg-muted" : "bg-primary text-primary-foreground"
  return (
    <button className={`${base} ${v} ${className}`} {...props}>
      {children}
    </button>
  )
}
