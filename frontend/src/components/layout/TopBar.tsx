import { ExternalLink, Menu, Search } from "lucide-react";
import { Link } from "react-router-dom";
import type { JobOut } from "@/api/types";
import { TransitMark } from "@/components/brand/TransitMark";
import { API_DOCS_URL } from "@/api/url";
import { Kbd } from "@/components/ui/Badge";
import { Breadcrumbs } from "./Breadcrumbs";
import { JobTray } from "./JobTray";
import type { Crumb } from "./nav";

export interface TopBarProps {
  crumbs: Crumb[];
  onOpenPalette: () => void;
  onOpenMenu?: () => void;
  showMenuButton: boolean;
  jobs: JobOut[];
  onCancelJob?: (id: string) => void;
  jobConnection?: "live" | "connecting" | "offline";
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Sticky top bar: breadcrumbs, command-palette trigger, job tray, API docs link. */
export function TopBar({ crumbs, onOpenPalette, onOpenMenu, showMenuButton, jobs, onCancelJob, jobConnection }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-void/85 px-3 backdrop-blur-md md:px-6">
      {showMenuButton ? (
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open navigation"
          className="flex size-9 items-center justify-center rounded-md text-fg-secondary hover:bg-fg/[0.06] hover:text-fg"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
      ) : null}
      {showMenuButton ? (
        // On small screens the sidebar (and its wordmark) lives in the drawer; keep the mark visible.
        <Link to="/" className="-ml-1 flex shrink-0 items-center rounded-md" aria-label="Exoplanet Finder — Overview">
          <TransitMark size={26} />
        </Link>
      ) : null}
      <div className="min-w-0 flex-1">
        <Breadcrumbs items={crumbs} />
      </div>
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Open command palette"
        aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
        className="flex h-9 items-center gap-2 rounded-md border border-hairline-strong bg-space px-2.5 text-sm text-fg-secondary transition-colors hover:border-fg-muted hover:text-fg sm:w-60 lg:w-72"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="hidden flex-1 truncate text-left sm:inline">Search pages, targets…</span>
        <span className="hidden items-center gap-0.5 sm:flex">
          <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <JobTray jobs={jobs} onCancel={onCancelJob} connection={jobConnection} />
      <a
        href={API_DOCS_URL}
        target="_blank"
        rel="noreferrer"
        className="flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm text-fg-secondary transition-colors hover:bg-fg/[0.06] hover:text-fg"
      >
        <span className="hidden md:inline">API docs</span>
        <span className="sr-only md:hidden">API docs</span>
        <ExternalLink className="size-4" aria-hidden="true" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </header>
  );
}
