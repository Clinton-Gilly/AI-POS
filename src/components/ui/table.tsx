import type {
  HTMLAttributes,
  ReactNode,
  ThHTMLAttributes,
  TdHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

/**
 * A plain data table.
 *
 * Wrapped in its own horizontal scroll container so a wide table never makes
 * the whole page scroll sideways on a phone — the failure that makes admin
 * screens unusable on the device a shop owner actually carries.
 */
export function Table({
  children,
  caption,
}: {
  children: ReactNode;
  caption?: string;
}) {
  return (
    <div className="border-line overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function Th({
  className,
  numeric,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "bg-surface-sunken text-ink-muted border-line border-b px-3 py-2 text-left text-xs font-medium tracking-wide uppercase",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  numeric,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "border-line text-ink border-b px-3 py-2",
        numeric && "tabular text-right",
        className,
      )}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("hover:bg-surface-sunken", className)} {...props} />;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-line rounded-lg border border-dashed px-6 py-12 text-center">
      <p className="text-ink text-sm font-medium">{title}</p>
      {description && <p className="text-ink-muted mt-1 text-sm">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
