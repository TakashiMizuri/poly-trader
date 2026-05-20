/** Shared enter/exit animation classes (tw-animate-css). */
export const motionEnter =
  "animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both";

export const motionEnterFast =
  "animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-both";

export const motionFade = "animate-in fade-in duration-200 fill-mode-both";

export const motionFadeOut = "animate-out fade-out duration-150 fill-mode-both";

/** Stagger delay for grid/list children (ms). */
export function motionStagger(index: number, stepMs = 45): string {
  return `[--tw-animation-delay:${index * stepMs}ms]`;
}
