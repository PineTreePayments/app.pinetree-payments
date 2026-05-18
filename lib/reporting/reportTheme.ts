// Shared design tokens for PineTree report-output surfaces:
// email templates and PDF engine.
//
// Live dashboard pages (app/dashboard/**) use DashboardPrimitives
// (CompactMetricTile, MetricGrid, etc.) for their light floating-card UI.
// The dark premium style defined here is for generated report outputs only.

export type ReportAccent = "blue" | "green" | "red" | "neutral"

// ── Canonical hex color tokens ────────────────────────────────────────────────
// Used by email inline styles. PDF engine consumes PDF_RGB below.
// Email uses a single unified dark tile bg for broader client compatibility
// rather than per-accent tinted backgrounds.
export const REPORT_HEX = {
  brand:         "#0052FF",
  tileBg: {
    blue:        "#0c1a35",
    green:       "#091c14",
    red:         "#1b0b0d",
    neutral:     "#0f1728",
  },
  tileBorder: {
    blue:        "#1d4ed8",
    green:       "#047857",
    red:         "#7f1d1d",
    neutral:     "#1e2c47",
  },
  tileLabel: {
    blue:        "#60a5fa",
    green:       "#34d399",
    red:         "#db757a",
    neutral:     "#a8b0bd",
  },
  emailCard: {
    bgBlue:      "#f0f6ff",
    bgGreen:     "#f0faf5",
    bgNeutral:   "#f9fafb",
    borderBlue:  "#bfdbfe",
    borderGreen: "#a7f3d0",
    borderGray:  "#e5e7eb",
    labelBlue:   "#1d4ed8",
    labelGreen:  "#047857",
    labelGray:   "#6b7280",
    value:       "#0f1728",
  },
  insightBg:     "#eff6ff",
  insightBorder: "#bfdbfe",
} as const

// ── pdf-lib rgb() tuples ──────────────────────────────────────────────────────
// Spread directly into pdf-lib's rgb(): rgb(...PDF_RGB.brand)
type RGB3 = [number, number, number]

export const PDF_RGB = {
  brand:     [0,     0.321, 1    ] as RGB3,
  text:      [0.08,  0.1,   0.16 ] as RGB3,
  muted:     [0.35,  0.39,  0.47 ] as RGB3,
  line:      [0.86,  0.89,  0.94 ] as RGB3,
  white:     [1,     1,     1    ] as RGB3,
  headerSub: [0.7,   0.85,  1.0  ] as RGB3,
  tileBg: {
    blue:    [0.047, 0.102, 0.208] as RGB3,
    green:   [0.035, 0.110, 0.078] as RGB3,
    neutral: [0.059, 0.090, 0.157] as RGB3,
    red:     [0.106, 0.043, 0.051] as RGB3,
  },
  tileBorder: {
    blue:    [0.114, 0.306, 0.847] as RGB3,
    green:   [0.016, 0.471, 0.341] as RGB3,
    neutral: [0.118, 0.173, 0.278] as RGB3,
    red:     [0.498, 0.114, 0.114] as RGB3,
  },
  tileLabel: {
    blue:    [0.376, 0.647, 0.980] as RGB3,
    green:   [0.204, 0.827, 0.600] as RGB3,
    neutral: [0.659, 0.690, 0.741] as RGB3,
    red:     [0.859, 0.459, 0.478] as RGB3,
  },
}
