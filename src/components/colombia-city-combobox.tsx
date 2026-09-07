"use client"

import { KeyboardEvent, useId, useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
import { Input } from "@/components/ui/input"
import { COLOMBIA_CITIES } from "@/lib/colombia-cities"
import { cn } from "@/lib/utils"

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
}

export function ColombiaCityCombobox({ defaultValue = "" }: { defaultValue?: string }) {
  const listId = useId()
  const [value, setValue] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const options = useMemo(() => {
    const search = normalize(value.trim())
    return COLOMBIA_CITIES.filter((city) => !search || normalize(city).includes(search)).slice(0, 6)
  }, [value])

  function choose(city: string) {
    setValue(city)
    setOpen(false)
    setActiveIndex(0)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") return setOpen(false)
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => Math.min(current + 1, Math.max(0, options.length - 1)))
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((current) => Math.max(0, current - 1))
    }
    if (event.key === "Enter" && open && options[activeIndex]) {
      event.preventDefault()
      choose(options[activeIndex])
    }
  }

  return <div className="relative">
    <Input
      id="delivery-city"
      name="city"
      role="combobox"
      aria-expanded={open}
      aria-controls={listId}
      aria-autocomplete="list"
      className="h-9 pr-9"
      value={value}
      minLength={2}
      maxLength={100}
      autoComplete="off"
      placeholder="Search city"
      required
      onFocus={() => setOpen(true)}
      onBlur={() => window.setTimeout(() => setOpen(false), 100)}
      onChange={(event) => { setValue(event.target.value); setOpen(true); setActiveIndex(0) }}
      onKeyDown={handleKeyDown}
    />
    <ChevronDown className="pointer-events-none absolute right-3 top-2.5 size-4 text-muted-foreground" />
    {open && options.length > 0 && <div id={listId} role="listbox" className="absolute z-50 mt-1 max-h-44 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      {options.map((city, index) => <button key={city} type="button" role="option" aria-selected={value === city} className={cn("flex h-8 w-full items-center rounded-sm px-2 text-left text-sm hover:bg-accent hover:text-accent-foreground", index === activeIndex && "bg-accent text-accent-foreground")} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(city)}>{city}</button>)}
    </div>}
  </div>
}
