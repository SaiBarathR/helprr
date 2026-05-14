"use client"

import * as React from "react"
import { Clock } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface TimePickerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}

function parseTime(value: string): [string, string, string] {
  const [h = "0", m = "0", s = "0"] = (value || "00:00:00").split(":")
  return [pad(h), pad(m), pad(s)]
}

function pad(value: string | number): string {
  const num = Number(value)
  if (!Number.isFinite(num)) return "00"
  return String(Math.min(Math.max(num, 0), 99)).padStart(2, "0")
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"))
const SIXTIES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"))

export function TimePicker({ value, onChange, disabled, className }: TimePickerProps) {
  const [hours, minutes, seconds] = parseTime(value)

  function emit(h: string, m: string, s: string) {
    onChange(`${h}:${m}:${s}`)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-start gap-2 font-mono tabular-nums",
            className
          )}
        >
          <Clock className="h-4 w-4 text-muted-foreground" />
          {`${hours}:${minutes}:${seconds}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="flex items-center gap-2">
          <TimeColumn
            label="HH"
            options={HOURS}
            value={hours}
            onChange={(v) => emit(v, minutes, seconds)}
          />
          <span className="text-muted-foreground">:</span>
          <TimeColumn
            label="MM"
            options={SIXTIES}
            value={minutes}
            onChange={(v) => emit(hours, v, seconds)}
          />
          <span className="text-muted-foreground">:</span>
          <TimeColumn
            label="SS"
            options={SIXTIES}
            value={seconds}
            onChange={(v) => emit(hours, minutes, v)}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface TimeColumnProps {
  label: string
  options: string[]
  value: string
  onChange: (value: string) => void
}

function TimeColumn({ label, options, value, onChange }: TimeColumnProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-16 font-mono tabular-nums">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[240px]">
          {options.map((option) => (
            <SelectItem key={option} value={option} className="font-mono tabular-nums">
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
