import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "destructive" | "muted" | "outline";

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-green-500 text-(--bg)",
  secondary: "bg-yellow-500 text-(--bg)",
  destructive: "bg-red-500 text-(--bg)",
  muted: "bg-muted text-muted-foreground border border-border",
  outline: "border border-border text-muted-foreground bg-transparent",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

function Badge({ className, variant = "muted", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };

