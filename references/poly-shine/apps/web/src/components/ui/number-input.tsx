import * as React from "react";
import { Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

function parseNum(raw: string) {
  if (raw.trim() === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

const stepBtnClass =
  "flex flex-1 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground active:bg-primary/15 active:text-primary disabled:pointer-events-none";

function NumberInput({
  className,
  value,
  defaultValue,
  onChange,
  step = 1,
  min,
  max,
  disabled,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const stepNum = step === "any" ? 1 : typeof step === "string" ? Number(step) : step;
  const delta = Number.isFinite(stepNum) && stepNum > 0 ? stepNum : 1;

  function bump(direction: 1 | -1) {
    if (disabled) return;
    const current = parseNum(String(value ?? defaultValue ?? ""));
    let next = current + direction * delta;
    if (min != null) next = Math.max(next, Number(min));
    if (max != null) next = Math.min(next, Number(max));
    const str = String(next);
    onChange?.({
      target: { value: str },
      currentTarget: { value: str },
    } as React.ChangeEvent<HTMLInputElement>);
  }

  return (
    <div
      data-slot="number-input"
      className={cn(
        "flex h-9 w-full min-w-0 overflow-hidden rounded-lg border border-border bg-input shadow-none",
        "transition-[color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        disabled && "pointer-events-none opacity-50",
        className
      )}
    >
      <input
        type="number"
        data-slot="number-input-field"
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        className={cn(
          "number-input-field min-w-0 flex-1 bg-transparent px-3 text-sm tabular-nums text-foreground outline-none",
          "placeholder:text-muted-foreground disabled:cursor-not-allowed"
        )}
        {...props}
      />
      <div
        role="group"
        aria-label="Adjust value"
        className="flex w-8 shrink-0 flex-col border-l border-border/80 bg-secondary/50"
      >
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label="Increase value"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => bump(1)}
          className={stepBtnClass}
        >
          <Plus className="size-3 stroke-[2.5]" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label="Decrease value"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => bump(-1)}
          className={cn(stepBtnClass, "border-t border-border/80")}
        >
          <Minus className="size-3 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
}

export { NumberInput };
