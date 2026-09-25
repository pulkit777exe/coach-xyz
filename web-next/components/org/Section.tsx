import type { ReactNode } from "react";

/**
 * A titled content section: 16px/600 heading over a hairline rule,
 * then the section body. Used across settings, account and dashboard pages.
 */
export default function Section({
  title,
  children,
  actions,
  className = "",
}: {
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="flex items-center justify-between gap-4 border-b border-border pb-2.5">
        <h2 className="text-lead font-semibold leading-[1.4] tracking-[-0.01em] text-foreground">
          {title}
        </h2>
        {actions}
      </div>
      <div className="pt-4">{children}</div>
    </section>
  );
}
