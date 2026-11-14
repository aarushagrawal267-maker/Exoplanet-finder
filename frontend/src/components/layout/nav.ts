/**
 * Navigation model: sidebar groups, routes, breadcrumbs and command-palette entries all derive
 * from this one list so they cannot drift apart.
 */
import {
  Activity,
  BookOpen,
  Cpu,
  Crosshair,
  Database,
  FlaskConical,
  Gauge,
  History,
  LayoutGrid,
  Radar,
  Settings2,
  Star,
  Telescope,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { TransitIcon } from "@/components/brand/TransitIcon";

export type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: NavIcon;
  /** One-line description (command palette, page placeholders). */
  description: string;
  keywords?: string[];
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "observe",
    label: "Observe",
    items: [
      {
        id: "overview",
        label: "Overview",
        path: "/",
        icon: Telescope,
        description: "Catalogue, light curves, datasets and models at a glance.",
        keywords: ["home", "dashboard", "summary"],
      },
      {
        id: "signals",
        label: "Signal Explorer",
        path: "/signals",
        icon: Activity,
        description: "Browse Kepler light curves and threshold-crossing events.",
        keywords: ["light curve", "tce", "koi", "flux"],
      },
      {
        id: "transit",
        label: "Transit Analysis",
        path: "/transit",
        icon: TransitIcon,
        description: "Search periods with BLS, fold, fit and vet a transit.",
        keywords: ["bls", "periodogram", "fold", "odd even", "secondary"],
      },
    ],
  },
  {
    id: "detect",
    label: "Detect",
    items: [
      {
        id: "detect",
        label: "Planet Detection",
        path: "/detect",
        icon: Radar,
        description: "Score a signal or uploaded light curve with your trained models.",
        keywords: ["predict", "classify", "upload", "inference"],
      },
      {
        id: "candidates",
        label: "Candidate Explorer",
        path: "/candidates",
        icon: Crosshair,
        description: "Rank unconfirmed candidates by model score and agreement.",
        keywords: ["rank", "leads", "batch"],
      },
      {
        id: "predictions",
        label: "Prediction History",
        path: "/predictions",
        icon: History,
        description: "Every prediction you have made, with its model and inputs.",
        keywords: ["history", "log", "past"],
      },
    ],
  },
  {
    id: "data",
    label: "Data",
    items: [
      {
        id: "datasets",
        label: "Dataset Explorer",
        path: "/datasets",
        icon: Database,
        description: "Build labelled datasets from the catalogue and inspect their splits.",
        keywords: ["dataset", "labels", "split", "tier", "download"],
      },
    ],
  },
  {
    id: "models",
    label: "Models",
    items: [
      {
        id: "training",
        label: "Model Training",
        path: "/training",
        icon: Cpu,
        description: "Train logistic regression, random forest and CNN classifiers.",
        keywords: ["train", "cnn", "epochs", "machine learning"],
      },
      {
        id: "evaluation",
        label: "Model Evaluation",
        path: "/evaluation",
        icon: Gauge,
        description: "ROC/PR curves, calibration and errors on held-out data.",
        keywords: ["roc", "pr", "auc", "metrics", "confusion", "calibration"],
      },
      {
        id: "experiments",
        label: "Experiments",
        path: "/experiments",
        icon: FlaskConical,
        description: "Compare runs, configurations and reports.",
        keywords: ["runs", "compare", "report"],
      },
    ],
  },
  {
    id: "reference",
    label: "Reference",
    items: [
      {
        id: "docs",
        label: "Research Docs",
        path: "/docs",
        icon: BookOpen,
        description: "Methodology, NASA data sources and known limitations.",
        keywords: ["documentation", "methodology", "limitations"],
      },
      {
        id: "settings",
        label: "Settings",
        path: "/settings",
        icon: Settings2,
        description: "Device, storage, downloads and display preferences.",
        keywords: ["preferences", "storage", "device", "gpu"],
      },
    ],
  },
];

/** Routes that exist but are not in the sidebar. */
export const HIDDEN_ROUTES: Array<NavItem & { groupLabel: string }> = [
  {
    id: "target",
    label: "Target Dossier",
    path: "/targets/:kepid",
    icon: Star,
    groupLabel: "Targets",
    description: "Everything known about one Kepler target.",
  },
  {
    id: "design",
    label: "Design System",
    path: "/design",
    icon: LayoutGrid,
    groupLabel: "Reference",
    description: "Every UI primitive and chart with demo data, for visual QA.",
    keywords: ["ui", "components", "tokens", "style guide"],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export interface Crumb {
  label: string;
  path?: string;
}

/** Breadcrumbs for a pathname: group → page (→ target id). */
export function breadcrumbsFor(pathname: string): Crumb[] {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const target = clean.match(/^\/targets\/([^/]+)$/);
  if (target) {
    const id = decodeURIComponent(target[1] ?? "");
    return [{ label: "Targets", path: "/candidates" }, { label: /^\d+$/.test(id) ? `KIC ${id}` : id }];
  }
  const doc = clean.match(/^\/docs\/([^/]+)$/);
  if (doc) {
    const slug = decodeURIComponent(doc[1] ?? "").replace(/[-_]+/g, " ");
    return [{ label: "Reference" }, { label: "Research Docs", path: "/docs" }, { label: slug.charAt(0).toUpperCase() + slug.slice(1) }];
  }
  for (const g of NAV_GROUPS) {
    const item = g.items.find((i) => i.path === clean);
    if (item) return [{ label: g.label }, { label: item.label }];
  }
  const hidden = HIDDEN_ROUTES.find((r) => r.path === clean);
  if (hidden) return [{ label: hidden.groupLabel }, { label: hidden.label }];
  return [{ label: "Not found" }];
}

/** True when `item` is the active nav entry for `pathname`. */
export function isActive(item: NavItem, pathname: string): boolean {
  if (item.path === "/") return pathname === "/";
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}
