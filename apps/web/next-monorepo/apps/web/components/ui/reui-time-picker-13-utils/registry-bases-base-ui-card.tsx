import * as React from "react"

import { forwardRef, type HTMLAttributes } from "react"

type Props = HTMLAttributes<HTMLDivElement>
const part = (name: string) => ({ className = "", ...props }: Props) => <div className={`${name} ${className}`} {...props} />

export const Card = forwardRef<HTMLDivElement, Props>(({ className = "", ...props }, ref) => <div ref={ref} className={`rounded-xl border border-border bg-card text-card-foreground shadow-sm ${className}`} {...props} />)
export const CardHeader = part("p-6 pb-3")
export const CardContent = part("p-6 pt-3")
export const CardFooter = part("flex items-center gap-2 p-6 pt-3")
export const CardTitle = part("text-lg font-semibold")
export const CardDescription = part("mt-1 text-sm text-muted-foreground")
