import type { SVGProps } from "react";

/** One stroke family for every icon: 24 grid, 1.7 stroke, round caps. Decorative unless a label is passed. */
type Props = SVGProps<SVGSVGElement> & { size?: number; label?: string };

function Svg({ size = 18, label, children, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M8 5.5v13l10.5-6.5z" />
  </Svg>
);
export const RefreshIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M20 11.5A8 8 0 0 0 6.3 6.3L4 8.6" />
    <path d="M4 4v4.6h4.6" />
    <path d="M4 12.5a8 8 0 0 0 13.7 5.2l2.3-2.3" />
    <path d="M20 20v-4.6h-4.6" />
  </Svg>
);
export const CheckIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const ShieldIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3.2 19.5 6v5.6c0 4.4-3.1 8-7.5 9.2-4.4-1.2-7.5-4.8-7.5-9.2V6z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Svg>
);
export const ClockIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const CopyIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" />
    <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
  </Svg>
);
export const ChevronIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m9 5.5 6.5 6.5L9 18.5" />
  </Svg>
);
export const BackIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M19 12H5.5" />
    <path d="m11 5.5-6.5 6.5 6.5 6.5" />
  </Svg>
);
export const PlusIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const CloseIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);
export const ExternalIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V7.5A1.5 1.5 0 0 1 5.5 6H10" />
  </Svg>
);
export const RecordIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-10z" />
    <path d="M14 3.5v5h5" />
    <path d="M8.5 13h7M8.5 16.5h5" />
  </Svg>
);
export const PrintIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M7 9V3.5h10V9" />
    <rect x="3.5" y="9" width="17" height="7.5" rx="2" />
    <path d="M7 14h10v6.5H7z" />
  </Svg>
);
export const BranchIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="6.5" cy="5.5" r="2" />
    <circle cx="6.5" cy="18.5" r="2" />
    <circle cx="17.5" cy="7.5" r="2" />
    <path d="M6.5 7.5v9" />
    <path d="M17.5 9.5c0 4-5 3.5-9.6 7.5" />
  </Svg>
);
/** The Muse Spark mark: a four point spark. */
export const SparkIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3c.6 4.6 3.4 7.4 8 8-4.6.6-7.4 3.4-8 8-.6-4.6-3.4-7.4-8-8 4.6-.6 7.4-3.4 8-8z" />
  </Svg>
);
export const QuestionIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.1-2.4 3.6" />
    <path d="M12 17.2h.01" />
  </Svg>
);
