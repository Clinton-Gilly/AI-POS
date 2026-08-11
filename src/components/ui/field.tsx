import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { useId } from "react";
import { cn } from "@/lib/utils";

const controlClasses =
  "h-10 w-full rounded-[--radius-control] border border-line bg-surface px-3 text-sm " +
  "text-ink placeholder:text-ink-subtle focus-visible:border-brand";

/**
 * Label, control and error are one component so a field cannot ship without a
 * programmatic label — the commonest accessibility defect in admin UIs, and
 * one that a shop owner using a screen reader would hit on their first form.
 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: { id: string; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-ink block text-sm font-medium">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children({ id, "aria-describedby": describedBy })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-ink-subtle text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClasses, className)} {...props} />;
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(controlClasses, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}
