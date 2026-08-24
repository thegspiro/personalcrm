import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-accent-3 text-accent-11",
        outline: "border-border text-muted-foreground",
        solid: "border-transparent bg-primary text-primary-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        success: "border-transparent bg-[color-mix(in_oklab,var(--success)_18%,transparent)] text-[var(--success)]",
        warning: "border-transparent bg-[color-mix(in_oklab,var(--warning)_20%,transparent)] text-[var(--warning)]",
        destructive:
          "border-transparent bg-[color-mix(in_oklab,var(--destructive)_16%,transparent)] text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
