import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-[38px] items-center justify-center gap-2 rounded-[9px] px-4 text-[13px] font-semibold outline-none transition-[background,border-color,opacity] duration-100 focus-visible:ring-2 focus-visible:ring-[var(--forest)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary:
          "border border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)] shadow-[0_1px_2px_var(--shadow)] hover:opacity-90",
        secondary:
          "border border-[var(--border)] bg-[var(--card)] text-[var(--ink)] shadow-[0_1px_2px_var(--shadow)] hover:border-[var(--line-strong)] hover:bg-[var(--panel)]",
        ghost: "text-[var(--ink)] hover:bg-[var(--panel)]",
        danger: "text-[var(--error)] hover:bg-[var(--error-soft)]",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant }), className)} {...props} />
  );
}
