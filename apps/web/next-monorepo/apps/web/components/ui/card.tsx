"use client"

import React from "react"

export default function Card({ children, title, className = "", ...props }: React.HTMLAttributes<HTMLDivElement> & { title?: React.ReactNode }) {
  return (
    <div className={`bg-card border border-border rounded-md p-4 ${className}`} {...props}>
      {title && <div className="text-sm text-muted-foreground mb-2">{title}</div>}
      <div>{children}</div>
    </div>
  )
}
