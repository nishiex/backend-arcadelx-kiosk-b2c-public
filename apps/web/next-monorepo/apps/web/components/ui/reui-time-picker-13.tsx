"use client"

import * as React from "react"
import { useEffect, useRef, useState } from "react"
import gsap from "gsap"
import { TimePicker, TimePickerColumns, TimePickerPanel } from "./reui-time-picker-13-utils/virtual-time-picker"
import { Button } from "./reui-time-picker-13-utils/registry-bases-base-ui-button"
import { Calendar } from "./reui-time-picker-13-utils/registry-bases-base-ui-calendar"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./reui-time-picker-13-utils/registry-bases-base-ui-card"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
// Defaults are derived at render time: a fixed day and month (this picker once opened on
// October 2026) leaves the calendar in the past and offers a date the API rejects.
const today = () => new Date()

export type ReuiTimePickerProps = {
  date?: Date
  time?: string
  /** Minute granularity for the time column. 15 by default; 1 offers every minute. */
  minuteStep?: number
  onDateChange?: (date: Date) => void
  onTimeChange?: (time: string) => void
  onSchedule?: () => void
  title?: string
  description?: string
}

export function ReuiTimePicker({ date: controlledDate, time: controlledTime, minuteStep = 15, onDateChange, onTimeChange, onSchedule, title = "Schedule a price update", description = "Pick the date and time when this price should go live." }: ReuiTimePickerProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [localDate, setLocalDate] = useState(() => controlledDate ?? today())
  const [localTime, setLocalTime] = useState(controlledTime ?? "09:00")
  const date = controlledDate ?? localDate
  const time = controlledTime ?? localTime
  const setDate = (next: Date) => { setLocalDate(next); onDateChange?.(next) }
  const setTime = (next: string) => { setLocalTime(next); onTimeChange?.(next) }
  const summary = `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()} at ${time}`
  useEffect(() => {
    if (!cardRef.current) return
    gsap.fromTo(cardRef.current, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.25, ease: "power2.out" })
  }, [])

  return <Card ref={cardRef} className="w-fit max-w-full" data-time-picker>
    <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
    <CardContent><div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start"><Calendar mode="single" required selected={date} onSelect={setDate} defaultMonth={date} /><div className="flex justify-center self-stretch max-sm:border-t max-sm:pt-4 sm:border-s sm:ps-4"><TimePicker aria-label="Scheduled time" value={time} onValueChange={next => { if (next) setTime(next) }} minuteStep={minuteStep}><TimePickerPanel><TimePickerColumns /></TimePickerPanel></TimePicker></div></div></CardContent>
    <CardFooter><p role="status" className="me-3 min-w-0 flex-1 text-sm"><span className="font-medium tabular-nums">{summary}</span></p>{onSchedule && <Button onClick={onSchedule}>Schedule</Button>}</CardFooter>
  </Card>
}

export function Pattern() {
  const [scheduled, setScheduled] = useState<string | null>(null)
  const [date, setDate] = useState(() => today())
  const [time, setTime] = useState("09:00")
  return <ReuiTimePicker date={date} time={time} onDateChange={setDate} onTimeChange={setTime} onSchedule={() => setScheduled(`${date.toISOString().slice(0, 10)} ${time}`)} description={scheduled ? `Scheduled for ${scheduled}` : undefined} />
}

export default Pattern
