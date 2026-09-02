import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border shadow-xs text-sm font-semibold cursor-pointer transition-all outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 shrink-0 aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-brand/16 text-brand border-brand hover:bg-brand/30",
        brand: "bg-brand text-background border-brand hover:bg-brand/90",
        destructive:
          "bg-destructive/60 text-destructive-foreground border-transparent hover:bg-destructive/90 focus-visible:ring-destructive/40",
        outline:
          "bg-input/30 border-input text-foreground hover:bg-input/50 hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground border-transparent hover:bg-accent",
        ghost:
          "border-transparent shadow-none hover:bg-accent/50 hover:text-accent-foreground",
        link: "border-transparent shadow-none text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 gap-1 px-4 py-2 has-[>svg]:px-4",
        sm: "h-8 gap-1.5 px-3 text-xs has-[>svg]:px-3.5",
        lg: "h-11 gap-2 px-8 text-sm font-bold",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
