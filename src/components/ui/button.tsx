import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Sizes are floors, not suggestions: `default` is 40px and `lg` is 48px
 * because the common device is a cheap Android tablet used one-handed at a
 * counter, and a 32px target is a mis-tap during a queue.
 */
const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-[--radius-control] font-medium " +
    "transition-colors disabled:pointer-events-none disabled:opacity-50 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 whitespace-nowrap",
  {
    variants: {
      variant: {
        primary: "bg-brand text-brand-foreground hover:bg-brand-strong",
        secondary:
          "bg-surface-sunken text-ink border border-line hover:border-line-strong",
        ghost: "text-ink-muted hover:bg-surface-sunken hover:text-ink",
        danger: "bg-danger text-white hover:opacity-90",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        default: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size }), className)} {...props} />;
}
