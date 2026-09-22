import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/ui';

/**
 * A small modal for the workflow decisions (submit, approve, send back,
 * resolve a save conflict). Centred on laptops, a bottom sheet on phones.
 */
export const PlanDialog: React.FC<{
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  onClose: () => void;
  actions: React.ReactNode;
  /** let a dropdown inside the body spill out instead of being clipped */
  allowOverflow?: boolean;
}> = ({ title, description, children, onClose, actions, allowOverflow }) => {
  const ref = useRef<HTMLDivElement>(null);
  // callers pass inline closures; keep the latest without re-running the effect
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // an autoFocus field inside the dialog keeps its focus
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/35 backdrop-blur-[2px] sm:items-center sm:p-6">
      <div className="absolute inset-0" aria-hidden onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-panel shadow-float outline-none sm:max-w-md sm:rounded-2xl',
          !allowOverflow && 'overflow-hidden'
        )}
      >
        <div className="border-b border-line px-5 py-4">
          <h3 className="m-0 text-[15px] font-semibold text-ink">{title}</h3>
          {description && <div className="mt-1 text-[13px] text-muted">{description}</div>}
        </div>
        {children && (
          <div className={cn('flex flex-col gap-3 px-5 py-4', !allowOverflow && 'overflow-y-auto')}>
            {children}
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 rounded-b-2xl border-t border-line bg-panel2/50 px-5 py-3 sm:flex-row sm:justify-end">
          {actions}
        </div>
      </div>
    </div>,
    document.body
  );
};

/** Button recipes shared by the page toolbar and the dialogs. */
const btnBase =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold ' +
  'transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50';

export const btn = {
  primary: cn(btnBase, 'bg-accent text-accent-ink shadow-card hover:brightness-110 focus-visible:ring-accent/50'),
  secondary: cn(
    btnBase,
    'border border-line bg-panel text-ink shadow-card hover:border-accent/60 focus-visible:ring-accent/40'
  ),
  success: cn(btnBase, 'bg-emerald-600 text-white shadow-card hover:bg-emerald-700 focus-visible:ring-emerald-500/50'),
  warn: cn(btnBase, 'bg-amber-500 text-white shadow-card hover:bg-amber-600 focus-visible:ring-amber-500/50'),
  ghost: cn(btnBase, 'text-muted hover:bg-panel2 hover:text-ink focus-visible:ring-accent/40'),
};

export const textareaCls =
  'block w-full rounded-lg border border-line bg-panel px-3 py-2 text-[13px] text-ink outline-none ' +
  'placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/30';
