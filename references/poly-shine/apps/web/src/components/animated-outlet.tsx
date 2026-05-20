import { Outlet, useLocation } from "react-router-dom";
import { motionEnter } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Re-mounts outlet on route change so page enter animations replay. */
export function AnimatedOutlet() {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className={cn(motionEnter, "flex min-h-0 flex-1 flex-col outline-none")}>
      <Outlet />
    </div>
  );
}
