import type { ReactNode } from "react";
import clsx from "clsx";

interface PanelProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Standard titled panel used by every workspace region. */
export function Panel({ title, actions, children, className }: PanelProps) {
  return (
    <section className={clsx("panel", className)}>
      <header className="panel-header">
        <span>{title}</span>
        {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </section>
  );
}
