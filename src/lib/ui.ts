import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Shared Tailwind recipes for the map workspace.
 *
 * The four filter dropdowns are the same object wearing different contents — a
 * trigger button, a panel, a search box, a list of options. Spelling those out
 * in each component is how four "identical" popovers quietly drift into four
 * slightly different ones, so the class strings live here once and the
 * components compose them.
 *
 * `cn` is clsx + tailwind-merge: later classes win conflicts, which is what
 * makes a recipe overridable at the call site (`cn(selectTrigger, 'w-full')`)
 * instead of merely appended to.
 */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** Dropdown trigger. Full width on phones, intrinsic width from `sm` up. */
export const selectTrigger =
  'flex w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 ' +
  'text-left text-[13px] leading-5 text-ink shadow-card transition-colors ' +
  'hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:max-w-[15rem]';

/** The trigger's value text — truncates rather than stretching the bar. */
export const selectValue = 'flex-1 truncate';
export const selectPlaceholder = 'flex-1 truncate text-muted';
export const selectCaret = 'shrink-0 text-[10px] text-muted';

/**
 * Dropdown panel. Width is capped against the viewport so a panel opened by a
 * control near the right edge of a phone screen still fits on screen.
 */
export const selectPanel =
  'absolute left-0 top-full z-40 mt-1.5 w-[min(20rem,calc(100vw-2rem))] overflow-hidden ' +
  'rounded-xl border border-line bg-panel shadow-float';

export const selectSearch =
  'w-full border-0 border-b border-line bg-panel px-3 py-2.5 text-[13px] text-ink ' +
  'outline-none placeholder:text-faint';

export const selectList = 'max-h-72 overflow-y-auto overscroll-contain p-1';

export const selectOption =
  'flex cursor-pointer flex-col rounded-lg px-2.5 py-2 text-[13px] text-ink hover:bg-panel2';
export const selectOptionActive = 'bg-accent/10 text-accent';

export const selectGroupHead =
  'px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint';

export const selectEmpty = 'px-3 py-3 text-center text-[13px] text-muted';

/** A floating card over the map: layer controls, legends, the data sheet. */
export const floatCard = 'rounded-xl border border-line bg-panel/97 shadow-float backdrop-blur-sm';

/** Section label inside a floating card. */
export const cardLabel = 'text-[11px] font-semibold uppercase tracking-wider text-muted';
