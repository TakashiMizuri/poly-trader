import { Page } from "../components/Page";
import { motionEnterFast } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { WorkshopPortfolioPanel } from "./WorkshopPortfolioPanel";
import { WorkshopScreenerPanel } from "./WorkshopScreenerPanel";
import { useWorkshopCompare } from "./useWorkshopCompare";

export function WorkshopPage() {
  const compare = useWorkshopCompare();

  return (
    <div data-workshop className="flex h-full min-h-0 flex-col">
      <Page
        title="Workshop"
        description="Operator tools — compare wallets side by side or scan traders on a market with profile filters."
        fill
        className="h-full min-h-0"
      >
        <div
          className={cn(
            motionEnterFast,
            "grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-4 lg:grid-cols-2 lg:grid-rows-1"
          )}
        >
          <WorkshopPortfolioPanel compare={compare} />
          <WorkshopScreenerPanel compare={compare} />
        </div>
      </Page>
    </div>
  );
}
