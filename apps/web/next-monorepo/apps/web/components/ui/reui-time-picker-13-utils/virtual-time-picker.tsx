"use client"

import * as React from "react"
import { createContext, useContext, type ReactNode } from "react"

type ContextValue = { value: string; onValueChange: (value: string | null) => void; minuteStep: number }
const TimeContext = createContext<ContextValue | null>(null)

export function TimePicker({ value, onValueChange, minuteStep = 15, children, ...props }: { value: string; onValueChange: (value: string | null) => void; minuteStep?: number; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <TimeContext.Provider value={{ value, onValueChange, minuteStep }}><div data-time-picker {...props}>{children}</div></TimeContext.Provider>
}

export function TimePickerPanel({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-lg border border-border bg-background p-2 ${className}`}>{children}</div>
}

export function TimePickerColumns() {
  const context = useContext(TimeContext)
  if (!context) throw new Error("TimePickerColumns must be used inside TimePicker")
  const [hour = "00", minute = "00"] = context.value.split(":")
  const minutes = Array.from({ length: Math.ceil(60 / context.minuteStep) }, (_, index) => index * context.minuteStep)
  const set = (nextHour: string, nextMinute: string) => context.onValueChange(`${nextHour}:${nextMinute}`)
  return <div className="flex items-center gap-2">
    <select aria-label="Hour" value={hour} onChange={event => set(event.target.value, minute)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">{Array.from({ length: 24 }, (_, index) => { const value = index.toString().padStart(2, "0"); return <option key={value} value={value}>{value}</option> })}</select>
    <span className="font-medium">:</span>
    <select aria-label="Minute" value={minute} onChange={event => set(hour, event.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">{minutes.map(index => { const value = index.toString().padStart(2, "0"); return <option key={value} value={value}>{value}</option> })}</select>
  </div>
}
