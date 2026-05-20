export type EngineMode = "read_only" | "shadow" | "live";



export type EngineState = {

  id: number;

  paused: boolean;

  mode: EngineMode;

  cancelAllOnKill: boolean;

  updatedAt: string;

};



export type CheckStatus = "ok" | "warn" | "error" | "idle";

export type ConnectivityCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
};

export type ConnectivityResponse = {
  checks: ConnectivityCheck[];
  checkedAt: string;
};

export type StatusResponse = {

  engine: EngineState | null;

  counts: {

    subscriptions: number;

    leaderEvents: number;

    mirrorIntents: number;

    mirrorPosted: number;

  };

  sqlitePath: string;

};



export type Subscription = {

  id: string;

  address: string;

  label: string | null;

  active: boolean;

  lastTradeTimestamp: number | null;

  followFromTimestamp: number | null;

  baselineAt: number | null;

  sizingMode: "fixed_usd" | "pct_balance" | "pct_leader_notional" | "proportional_equity";

  fixedUsd: string | null;

  pctBalance: string | null;

  pctLeaderNotional: string | null;

  maxNotionalPerTrade: string | null;

  maxOpenExposureUsd: string | null;

  maxDailyLossUsd: string | null;

  maxOrdersPerSecond: number | null;

  maxSlippageBps: number | null;

  createdAt: string;

  updatedAt: string;

};



export type LeaderEvent = {

  id: string;

  subscriptionId: string;

  side: string;

  size: string;

  price: string;

  asset: string;

  tradeTimestamp: number;

  createdAt: string;

};



export type MirrorPlanned = {

  side?: string;

  price?: number;

  size?: number;

  leaderShares?: number;

  leaderPrice?: number;

  sizingMode?: string;

  sizingBasis?: "cash_ratio" | "position_fraction";

  followLineState?: string;

  leaderCash?: number;

  followerCash?: number;

  balanceRatio?: number;

  proportionalScale?: number;

  leaderPositionBefore?: number;

  followerPosition?: number;

  closeFraction?: number;

  rawShares?: number;

  cappedBy?: "max_notional" | "cash" | "position" | "rounding";

  roundedShares?: number;

};



export type MirrorIntent = {

  id: string;

  subscriptionId: string;

  leaderEventId: string;

  status: string;

  skipReason: string | null;

  planned?: MirrorPlanned | null;

  createdAt: string;

  marketTitle: string | null;

  marketIcon: string | null;

  marketOutcome: string | null;

  marketSlug: string | null;

};



export type TradeFeedItem = {

  eventId: string;

  tradeTimestamp: number;

  /** DB ingestion time; tie-break with eventId for fill order within the same second. */
  eventCreatedAt: string;

  side: string;

  leaderSize: string;

  leaderPrice: string;

  asset: string;

  subscriptionId: string;

  subscriptionLabel: string | null;

  subscriptionAddress: string;

  subscriptionActive: boolean;

  intentId: string | null;

  intentStatus: string | null;

  skipReason: string | null;

  planned: MirrorPlanned | null;

  executed: boolean | null;

  marketTitle: string | null;

  marketIcon: string | null;

  marketOutcome: string | null;

  /** Gamma slug for opening the market on polymarket.com. */
  marketSlug: string | null;

  /** Polymarket market is closed / resolved (no longer tradeable). */
  marketClosed: boolean;

  /** Market event window start (epoch ms), from Gamma when available. */
  marketStartAt: number | null;

  /** Market event window end (epoch ms), from Gamma when available. */
  marketEndAt: number | null;

  /** Proportional follow line state for (subscription, asset), when tracked. */
  followLineState: string | null;

  /** Root reason the line was abandoned (e.g. pre_existing_position). */
  followLineAbandonedReason: string | null;

};



export type Execution = {

  id: string;

  mirrorIntentId: string;

  success: boolean;

  createdAt: string;

};



export type AuditEntry = {

  id: string;

  action: string;

  detail: Record<string, unknown> | null;

  createdAt: string;

};



export type PolymarketEquity = {

  cashBalance: number;

  positionsValue: number;

  equity: number;

  valuationTime: string;

};



export type PolymarketEquityResult = PolymarketEquity | { error: string };



export type EquityBatchResponse = {

  balances: Record<string, PolymarketEquityResult>;

};

export type LeaderboardUserStats = {
  pnl: number;
  vol: number;
  rank: string | null;
  userName: string | null;
};

export type PolymarketLeaderboardPnls = {
  day: LeaderboardUserStats | null;
  week: LeaderboardUserStats | null;
  month: LeaderboardUserStats | null;
  all: LeaderboardUserStats | null;
};

export type PolymarketPortfolioSnapshot = {
  address: string;
  displayName: string | null;
  equity: PolymarketEquity;
  positions: { count: number; openCashPnl: number };
  leaderboard: PolymarketLeaderboardPnls;
};

export type PolymarketPortfolioResult = PolymarketPortfolioSnapshot | { error: string };

export type PortfolioBatchResponse = {
  portfolios: Record<string, PolymarketPortfolioResult>;
};

export type ResolvedPolymarketMarket = {
  conditionId: string;
  title: string;
  slug: string | null;
  closed: boolean | null;
};

export type MarketParticipantDto = {
  address: string;
  marketStake: number | null;
  displayName: string | null;
  sources: ("holder" | "trade")[];
};

export type ScreenerTickResponse = {
  tickAt: string;
  participants: MarketParticipantDto[];
  portfolios: Record<string, PolymarketPortfolioResult>;
};

export type MeResponse = {
  address: string | null;
  displayName: string | null;
  profileImage: string | null;
  error?: string;
};

