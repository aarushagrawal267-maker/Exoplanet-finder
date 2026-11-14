/**
 * Application shell: collapsible sidebar (248 px ↔ 72 px rail; a drawer below 768 px), sticky
 * top bar with breadcrumbs, the Ctrl/⌘+K command palette and the job tray, and the routed page
 * content.
 */
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useJobFeed } from "@/api/endpoints/jobStream";
import { useUiPreferences } from "@/lib/uiPreferences";
import type { JobOut } from "@/api/types";
import { TransitLoader } from "@/components/brand/TransitLoader";
import { Drawer } from "@/components/ui/Drawer";
import { cn } from "@/lib/cn";
import { useLocalStorage, useMediaQuery } from "@/lib/hooks";
import { CommandPalette, type CommandItem } from "./CommandPalette";
import { breadcrumbsFor } from "./nav";
import { Sidebar } from "./Sidebar";
import { StatusFooter } from "./StatusFooter";
import { TopBar } from "./TopBar";
import { useSystemStatus } from "./useSystemStatus";

export interface AppShellProps {
  /** Jobs for the tray; omit to use the live job feed (`useJobFeed`: /api/jobs/stream + polling). */
  jobs?: JobOut[];
  onCancelJob?: (id: string) => void;
  /** Target search for the command palette (wired to /api/targets/search later). */
  onSearch?: (query: string, signal: AbortSignal) => Promise<CommandItem[]>;
  children?: ReactNode;
}

export function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <TransitLoader size={56} label="Loading page" showLabel />
    </div>
  );
}

export function AppShell({ jobs, onCancelJob, onSearch, children }: AppShellProps) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [collapsed, setCollapsed] = useLocalStorage<boolean>("exo.sidebar.collapsed", false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const status = useSystemStatus();
  const jobFeed = useJobFeed({ enabled: jobs === undefined });
  useUiPreferences();

  // Close the mobile drawer on navigation / when growing past the breakpoint.
  useEffect(() => setDrawerOpen(false), [location.pathname, isMobile]);

  // Global shortcut: Ctrl/⌘ + K toggles the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Move focus to the main region after client-side route changes (screen-reader friendly).
  // Not on the initial load: there the browser's natural tab order (skip link → sidebar → page)
  // must be preserved, otherwise keyboard users start inside the page and never reach the nav.
  // (Compares against the previous path rather than a "first render" flag, which StrictMode's
  // double-invoked effects would defeat.)
  const lastPath = useRef(location.pathname);
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    document.getElementById("main")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  const crumbs = breadcrumbsFor(location.pathname);
  const pageLabel = crumbs[crumbs.length - 1]?.label;
  useEffect(() => {
    document.title = pageLabel && location.pathname !== "/" ? `${pageLabel} · Exoplanet Finder` : "Exoplanet Finder";
  }, [pageLabel, location.pathname]);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const rail = !isMobile && collapsed;

  return (
    <div className="min-h-screen bg-void text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-cosmic focus:px-3 focus:py-2 focus:text-void"
      >
        Skip to content
      </a>

      {!isMobile ? (
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 border-r border-hairline transition-[width] duration-slow ease-out",
            rail ? "w-rail" : "w-sidebar",
          )}
          aria-label="Sidebar"
        >
          <Sidebar collapsed={rail} onToggleCollapsed={() => setCollapsed(!collapsed)} footer={<StatusFooter rows={status} collapsed={rail} />} />
        </aside>
      ) : (
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} side="left" width={280} bare aria-label="Navigation">
          <Sidebar collapsed={false} hideToggle onNavigate={() => setDrawerOpen(false)} footer={<StatusFooter rows={status} />} />
        </Drawer>
      )}

      <div className={cn("flex min-h-screen flex-col transition-[padding] duration-slow ease-out", isMobile ? "pl-0" : rail ? "pl-rail" : "pl-sidebar")}>
        <TopBar
          crumbs={crumbs}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenMenu={() => setDrawerOpen(true)}
          showMenuButton={isMobile}
          jobs={jobs ?? jobFeed.jobs}
          onCancelJob={onCancelJob ?? jobFeed.cancel}
          jobConnection={jobs ? undefined : jobFeed.connection}
        />
        <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
          <div className="mx-auto w-full max-w-content px-4 py-6 md:px-8 md:py-8">
            <Suspense fallback={<PageFallback />}>{children ?? <Outlet />}</Suspense>
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={closePalette} onNavigate={(p) => navigate(p)} onSearch={onSearch} />
    </div>
  );
}
