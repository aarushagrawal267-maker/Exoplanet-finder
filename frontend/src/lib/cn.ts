import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge taught about the custom type scale (`text-2xs`, `text-md`) so that a caller's
 * `className="text-md"` correctly overrides a component's default `text-base`, and is not
 * mistaken for a text *colour*.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs", "xs", "sm", "base", "md", "lg", "xl", "2xl"] }],
      "border-color": [{ border: ["hairline", "hairline-strong"] }],
    },
  },
});

/** Compose class names: conditional (clsx) + conflict-resolving (tailwind-merge). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
