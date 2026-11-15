/**
 * Sidebar — grouped navigation (OBSERVE / DETECT / DATA / MODELS / REFERENCE).
 * Expanded: 248 px with labels. Rail: 72 px, icons with tooltips. On small screens the same
 * content is rendered inside a Drawer by AppShell.
 */
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Wordmark } from "@/components/brand/TransitMark";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";
import { isActive, NAV_GROUPS, type NavItem } from "./nav";

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  /** Called after navigating (used to close the mobile drawer). */
  onNavigate?: () => void;
  /** Footer slot for device / model / dataset status. */
  footer?: ReactNode;
  /** Hide the collapse toggle (mobile drawer). */
  hideToggle?: boolean;
  className?: string;
}

function NavEntry({ item, collapsed, active, onNavigate }: { item: NavItem; collapsed: boolean; active: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.path}
      end={item.path === "/"}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex items-center rounded-md text-base transition-colors duration-fast",
        collapsed ? "mx-auto size-10 justify-center short:size-9" : "h-9 gap-3 px-3 short:h-8",
        active ? "bg-cosmic/[0.09] text-fg" : "text-fg-secondary hover:bg-fg/[0.05] hover:text-fg",
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className={cn("absolute w-[2px] rounded-full bg-gradient-to-b from-nebula to-cosmic", collapsed ? "-left-[15px] inset-y-2" : "-left-3 inset-y-1.5")}
        />
      ) : null}
      <Icon size={18} strokeWidth={1.75} className={cn("shrink-0", active ? "text-cosmic" : "text-fg-secondary group-hover:text-fg")} />
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={item.label} side="right" delayMs={100}>
      {link}
    </Tooltip>
  ) : (
    link
  );
}

export function Sidebar({ collapsed, onToggleCollapsed, onNavigate, footer, hideToggle = false, className }: SidebarProps) {
  const { pathname } = useLocation();
  return (
    <div className={cn("flex h-full flex-col bg-space", className)}>
      <div className={cn("flex h-16 shrink-0 items-center border-b border-hairline", collapsed ? "justify-center px-2" : "justify-between gap-2 px-4")}>
        <NavLink to="/" onClick={onNavigate} className="rounded-md" aria-label="Exoplanet Finder — Overview">
          <Wordmark collapsed={collapsed} />
        </NavLink>
        {!hideToggle && !collapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Collapse sidebar"
            className="flex size-8 items-center justify-center rounded-md text-fg-secondary hover:bg-fg/[0.06] hover:text-fg"
          >
            <PanelLeftClose className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <nav aria-label="Main" className={cn("relative min-h-0 flex-1 overflow-y-auto py-4 short:py-3", collapsed ? "px-3" : "px-4")}>
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.id} className={cn(gi > 0 && (collapsed ? "mt-3 border-t border-hairline pt-3 short:mt-2 short:pt-2" : "mt-5 short:mt-3"))}>
            {!collapsed ? (
              <h2 className="eyebrow mb-1.5 px-3 text-fg-secondary short:mb-1" id={`nav-${group.id}`}>
                {group.label}
              </h2>
            ) : (
              <h2 className="sr-only" id={`nav-${group.id}`}>
                {group.label}
              </h2>
            )}
            <ul aria-labelledby={`nav-${group.id}`} className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.id}>
                  <NavEntry item={item} collapsed={collapsed} active={isActive(item, pathname)} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
        {/* Scroll affordance: on very short viewports the list still scrolls; items fade under
            the footer instead of being cut by a hard edge. Sits in the bottom padding when the
            list fits, so it is invisible then. */}
        <div aria-hidden="true" className="pointer-events-none sticky bottom-0 -mb-4 h-6 bg-gradient-to-t from-space to-transparent short:-mb-3" />
      </nav>

      {footer ? <div className={cn("shrink-0 border-t border-hairline", collapsed ? "px-2 py-3" : "px-4 py-3")}>{footer}</div> : null}

      {!hideToggle && collapsed ? (
        <div className="flex shrink-0 justify-center border-t border-hairline py-2">
          <Tooltip content="Expand sidebar" side="right">
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Expand sidebar"
              className="flex size-9 items-center justify-center rounded-md text-fg-secondary hover:bg-fg/[0.06] hover:text-fg"
            >
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}
