import * as React from "react"

import type { ButtonHTMLAttributes } from "react"

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 ${className}`} {...props} />
}
