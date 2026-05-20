import { cn } from "@/lib/utils";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={cn("font-bold tracking-tight", className)}>
      <span className="text-white logo-glow-white">poly-</span>
      <span className="text-primary logo-glow-primary">shine</span>
    </span>
  );
}
