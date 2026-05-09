// SPDX-License-Identifier: BUSL-1.1
//
// Standard button primitive — variants for primary/secondary/ghost/destructive
// + sizes. All chrome buttons should adopt this; ad-hoc <button> tags are
// fine for one-off shapes.

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-white hover:bg-accent-light",
        secondary:
          "border border-border bg-surface text-text-secondary hover:bg-bg-warm",
        ghost: "text-text-secondary hover:bg-bg-warm",
        destructive: "bg-red text-white hover:bg-red/90",
        outline:
          "border border-border bg-transparent text-text-secondary hover:bg-bg-warm",
        link: "text-accent hover:underline",
      },
      size: {
        sm: "h-7 px-2",
        md: "h-8 px-3",
        lg: "h-9 px-4 text-sm",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
