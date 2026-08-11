"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A modal built on the native `<dialog>` element.
 *
 * Chosen over a hand-rolled overlay because the browser gives focus trapping,
 * Escape-to-close, inert background content and the top layer for free —
 * accessibility behaviour that hand-rolled modals almost always get wrong.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Clicking the backdrop closes; clicking the panel must not.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-label={title}
      className="bg-surface-raised text-ink w-[min(32rem,calc(100vw-2rem))] rounded-lg p-0 shadow-xl backdrop:bg-black/40"
    >
      <div className="border-line border-b px-5 py-4">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      {footer && (
        <div className="border-line flex justify-end gap-2 border-t px-5 py-4">
          {footer}
        </div>
      )}
    </dialog>
  );
}
