import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-brand text-background border-transparent [a&]:hover:bg-brand/90",
        secondary:
          "bg-secondary text-secondary-foreground border-transparent [a&]:hover:bg-accent",
        destructive:
          "bg-destructive/60 text-white border-transparent focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        outline:
          "border-border bg-transparent text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-brand underline-offset-4 [a&]:hover:underline",
      },
      size: {
        xs: "h-5 px-1.5 text-[10px] leading-none [&>svg]:size-2.5",
        sm: "h-6 px-2 text-[11px] leading-none [&>svg]:size-3",
        md: "h-7 px-2.5 text-xs leading-none [&>svg]:size-3.5",
        lg: "h-8 px-3 text-sm leading-none [&>svg]:size-4",
      },
      tone: {
        neutral: "",
        red: "",
        amber: "",
        green: "",
        blue: "",
        sky: "",
        gray: "",
        yellow: "",
        cyan: "",
      },
    },
    // Tones map onto the six chart tokens so status colour never introduces a
    // palette outside the design system. `chart-1` (a deep blue) and `chart-5`
    // (pure red) are too dark to use as text straight from the token, so the
    // tinted rows lift them toward white — the same `color-mix` Tailwind itself
    // emits for `/opacity` — to clear the muted-foreground contrast floor.
    compoundVariants: [
      // Filled tones (variant=default) — solid background, contrasting text.
      { variant: "default", tone: "red", className: "bg-chart-5 text-white" },
      { variant: "default", tone: "amber", className: "bg-chart-6 text-background" },
      { variant: "default", tone: "green", className: "bg-chart-2 text-background" },
      { variant: "default", tone: "blue", className: "bg-chart-1 text-white" },
      { variant: "default", tone: "sky", className: "bg-chart-3 text-background" },
      { variant: "default", tone: "gray", className: "bg-muted-foreground text-background" },
      { variant: "default", tone: "yellow", className: "bg-chart-6 text-background" },
      { variant: "default", tone: "cyan", className: "bg-chart-3 text-background" },
      // Tinted outline tones — translucent bg + coloured text + coloured border.
      {
        variant: "outline",
        tone: "red",
        className:
          "border-chart-5/30 bg-chart-5/10 [color:color-mix(in_oklab,var(--chart-5),white_22%)]",
      },
      { variant: "outline", tone: "amber", className: "border-chart-6/30 bg-chart-6/10 text-chart-6" },
      { variant: "outline", tone: "green", className: "border-chart-2/30 bg-chart-2/10 text-chart-2" },
      {
        variant: "outline",
        tone: "blue",
        className:
          "border-chart-1/40 bg-chart-1/15 [color:color-mix(in_oklab,var(--chart-1),white_40%)]",
      },
      { variant: "outline", tone: "sky", className: "border-chart-3/30 bg-chart-3/10 text-chart-3" },
      { variant: "outline", tone: "gray", className: "border-border bg-muted/40 text-muted-foreground" },
      { variant: "outline", tone: "yellow", className: "border-chart-6/30 bg-chart-6/10 text-chart-6" },
      { variant: "outline", tone: "cyan", className: "border-chart-3/30 bg-chart-3/10 text-chart-3" },
    ],
    defaultVariants: {
      variant: "default",
      size: "md",
      tone: "neutral",
    },
  }
)

function Badge({
  className,
  variant = "default",
  size,
  tone,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant, size, tone }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
