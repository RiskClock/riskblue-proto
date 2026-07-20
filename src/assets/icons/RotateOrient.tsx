import { SVGProps } from "react";

/**
 * Rotate-orientation icon: a solid landscape rectangle with a dashed
 * portrait rectangle behind it and a curved arrow indicating a 90° turn.
 * Modeled after the reference "noun-rotate" mark.
 */
export const RotateOrientIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    {/* Dashed portrait "before" */}
    <rect x="6" y="3" width="10" height="14" rx="1" strokeDasharray="2 2" opacity="0.55" />
    {/* Solid landscape "after" */}
    <rect x="3" y="9" width="14" height="10" rx="1" />
    {/* Curved arrow indicating rotation */}
    <path d="M18 6a5 5 0 0 1 3 4.6" />
    <polyline points="21 6 21 10 17 10" />
  </svg>
);

export default RotateOrientIcon;
