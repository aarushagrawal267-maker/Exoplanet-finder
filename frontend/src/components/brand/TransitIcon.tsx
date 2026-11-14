import { forwardRef, type SVGProps } from "react";

/**
 * Lucide-compatible 24 px icon of the transit motif (star, occulting planet, dipping light curve),
 * used for "Transit Analysis". Accepts the same `size` / `strokeWidth` props as lucide icons.
 */
export const TransitIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>(
  function TransitIcon({ size = 24, strokeWidth = 2, className, ...rest }, ref) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
        {...rest}
      >
        <circle cx="12" cy="9" r="6" />
        <circle cx="14" cy="10" r="1.25" fill="currentColor" />
        <path d="M2 19.5h10l1 2h2l1-2h6" />
      </svg>
    );
  },
);
