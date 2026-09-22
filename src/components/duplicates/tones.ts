/**
 * One colour per record in a duplicate group, used by the profile and merge
 * dialogs so a record keeps the same colour in its column header, its value
 * buttons and its card. Index 0 is always the original (oldest record).
 */
export interface Tone {
  text: string;
  soft: string;
  picked: string;
  dot: string;
}

const TONES: Tone[] = [
  { text: 'text-sky-800', soft: 'bg-sky-50/90', picked: 'border-sky-400 bg-sky-50 text-sky-950 ring-1 ring-sky-300', dot: 'border-sky-500 bg-sky-500' },
  { text: 'text-amber-800', soft: 'bg-amber-50/90', picked: 'border-amber-400 bg-amber-50 text-amber-950 ring-1 ring-amber-300', dot: 'border-amber-500 bg-amber-500' },
  { text: 'text-violet-800', soft: 'bg-violet-50/90', picked: 'border-violet-400 bg-violet-50 text-violet-950 ring-1 ring-violet-300', dot: 'border-violet-500 bg-violet-500' },
  { text: 'text-rose-800', soft: 'bg-rose-50/90', picked: 'border-rose-400 bg-rose-50 text-rose-950 ring-1 ring-rose-300', dot: 'border-rose-500 bg-rose-500' },
  { text: 'text-teal-800', soft: 'bg-teal-50/90', picked: 'border-teal-400 bg-teal-50 text-teal-950 ring-1 ring-teal-300', dot: 'border-teal-500 bg-teal-500' },
  { text: 'text-lime-800', soft: 'bg-lime-50/90', picked: 'border-lime-500 bg-lime-50 text-lime-950 ring-1 ring-lime-300', dot: 'border-lime-600 bg-lime-600' },
];

export const toneOf = (i: number): Tone => TONES[i % TONES.length];

/** "Original", "Duplicate 1", "Duplicate 2"… */
export const roleOf = (i: number) => (i === 0 ? 'Original' : `Duplicate ${i}`);
