import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Activity, BookOpen, Cpu, LayoutDashboard, Users, Wrench } from "lucide-react";
import { AnimatedOutlet } from "@/components/animated-outlet";
import { BrandLogo } from "@/components/brand-logo";
import { SidebarPolymarketUser } from "@/components/sidebar-polymarket-user";
import { SidebarSettings } from "@/components/sidebar-settings";
import { cn } from "@/lib/utils";

const links: { to: string; label: string; end?: boolean; icon: LucideIcon }[] = [
  { to: "/", label: "Dashboard", end: true, icon: LayoutDashboard },
  { to: "/engine", label: "Engine", icon: Cpu },
  { to: "/subscriptions", label: "Subscriptions", icon: Users },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/workshop", label: "Workshop", icon: Wrench },
];

export function Layout() {
  return (
    <section className="flex h-screen min-h-screen">
      <aside className="sticky top-0 flex h-screen w-72 shrink-0 flex-col border-r border-border bg-card">
        <header className="border-b border-border px-6 py-6">
          <BrandLogo className="animate-in fade-in slide-in-from-left-2 duration-500 fill-mode-both text-3xl" />
          <p className="mt-1.5 text-sm text-muted-foreground">Operator console</p>
        </header>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-4">
          {links.map(({ to, label, end, icon: Icon }, i) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              style={{ animationDelay: `${80 + i * 40}ms` }}
              className={({ isActive }) =>
                cn(
                  "animate-in fade-in slide-in-from-left-2 fill-mode-both flex items-center gap-3 rounded-lg px-4 py-2.5 text-base font-medium duration-300",
                  "transition-[color,background-color,transform] active:scale-[0.98]",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )
              }
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <footer className="mt-auto shrink-0 space-y-1 border-t border-border p-4">
          <NavLink
            to="/docs"
            className={({ isActive }) =>
              cn(
                "flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-base font-medium transition-[color,background-color,transform] active:scale-[0.98]",
                isActive
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )
            }
          >
            <BookOpen className="size-4 shrink-0" aria-hidden />
            Documentation
          </NavLink>
          <SidebarSettings />
          <SidebarPolymarketUser />
        </footer>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto px-6 py-6 lg:px-8 xl:px-10 has-[[data-activity]]:h-full has-[[data-activity]]:overflow-hidden has-[[data-dashboard]]:h-full has-[[data-dashboard]]:overflow-hidden has-[[data-workshop]]:h-full has-[[data-workshop]]:overflow-hidden">
          <AnimatedOutlet />
        </main>
      </section>
    </section>
  );
}
