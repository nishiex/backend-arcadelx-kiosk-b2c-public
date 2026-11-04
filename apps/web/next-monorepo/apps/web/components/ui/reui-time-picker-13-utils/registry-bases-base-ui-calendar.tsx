"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"

type Props = { mode?: "single"; required?: boolean; selected?: Date; onSelect?: (date: Date) => void; defaultMonth?: Date }

export function Calendar({ selected, onSelect, defaultMonth }: Props) {
  const [month, setMonth] = useState(() => new Date((defaultMonth ?? selected ?? new Date()).getFullYear(), (defaultMonth ?? selected ?? new Date()).getMonth(), 1))
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const start = new Date(first)
    start.setDate(1 - first.getDay())
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start)
      date.setDate(start.getDate() + index)
      return date
    })
  }, [month])
  const sameDay = (a: Date | undefined, b: Date) => Boolean(a && a.toDateString() === b.toDateString())
  return (
    <div className="w-[280px] select-none" aria-label="Calendar">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" aria-label="Previous month" className="rounded-md p-1.5 hover:bg-muted" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
        <span className="text-sm font-medium">{month.toLocaleString("en", { month: "long", year: "numeric" })}</span>
        <button type="button" aria-label="Next month" className="rounded-md p-1.5 hover:bg-muted" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => <span key={day} className="py-1">{day}</span>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {days.map(date => <button key={date.toISOString()} type="button" onClick={() => onSelect?.(date)} className={`rounded-md py-1.5 text-sm hover:bg-muted ${date.getMonth() !== month.getMonth() ? "text-muted-foreground/40" : ""} ${sameDay(selected, date) ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`}>{date.getDate()}</button>)}
      </div>
    </div>
  )
}
