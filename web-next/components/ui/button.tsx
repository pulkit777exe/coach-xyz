import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost";
type ButtonSize = "default" | "sm" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-white text-black hover:bg-zinc-200 shadow-[0_0_0_1px_rgba(255,255,255,0.15)]",
  secondary:
    "bg-zinc-900 text-zinc-100 hover:bg-zinc-800 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]",
  outline:
    "bg-transparent text-zinc-100 border border-zinc-700 hover:bg-zinc-900/70",
  ghost: "bg-transparent text-zinc-300 hover:text-white hover:bg-zinc-900/60",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-10 px-4 py-2 text-sm",
  sm: "h-9 px-3 py-1.5 text-xs",
  lg: "h-11 px-6 py-3 text-sm",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button };

