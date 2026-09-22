import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/ui';

/**
 * A large modal for side-by-side work (profiles, the merge): a full-height
 * sheet on phones, a wide centred panel from `sm` up. Header and footer stay
 * fixed; only the body scrolls. Escape and the backdrop close it.
 */
export const WideDialog: React.FC<{
  title: React.ReactNode;
  label: string;
  subtitle?: React.ReactNode;
  headerExtra?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  size?: 'lg' | 'xl';
  children: React.ReactNode;
}> = ({ title, label, subtitle, headerExtra, footer, onClose, size = 'xl', children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-[2px] sm:items-center sm:p-5">
      <div className="absolute inset-0" aria-hidden onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal
        aria-label={label}
        tabIndex={-1}
        className={cn(
          'relative flex h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-panel shadow-float outline-none sm:h-[min(92dvh,60rem)] sm:rounded-2xl',
          size === 'xl' ? 'sm:max-w-6xl' : 'sm:max-w-3xl'
        )}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-line bg-gradient-to-b from-panel to-panel2/60 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h3 className="m-0 truncate text-[15px] font-semibold text-ink sm:text-base">{title}</h3>
            {subtitle && <div className="text-[12.5px] text-muted">{subtitle}</div>}
          </div>
          {headerExtra}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-panel2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && (
          <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-line bg-panel2/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-5">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
};

/** A two-option segmented control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; hint?: string }[];
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-panel2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50',
            value === o.value ? 'bg-panel text-ink shadow-card' : 'text-muted hover:text-ink'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
