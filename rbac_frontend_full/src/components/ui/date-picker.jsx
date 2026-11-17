import * as React from "react"
import { cn } from "@/lib/utils"

function DatePicker({
  date,
  onDateChange,
  placeholder = "Pick a date",
  disabled = false,
  className,
}) {
  // Guard against Invalid Date (e.g. a malformed string from the API):
  // toISOString() throws a RangeError on it, which crashed the whole page.
  const dateValue = date && !isNaN(date) ? date.toISOString().split("T")[0] : ""

  return (
    <input
      type="date"
      value={dateValue}
      onChange={(e) => {
        if (e.target.value) {
          onDateChange(new Date(e.target.value))
        } else {
          onDateChange(null)
        }
      }}
      disabled={disabled}
      placeholder={placeholder}
      className={cn(
        "w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white text-black placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-black focus:border-black",
        disabled && "bg-gray-100 cursor-not-allowed opacity-50",
        className
      )}
    />
  )
}

export { DatePicker }
