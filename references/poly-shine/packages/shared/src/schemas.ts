import { z } from "zod";

export const ethAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address");

export const sizingModeSchema = z.enum([
  "fixed_usd",
  "pct_balance",
  "pct_leader_notional",
  "proportional_equity",
]);

export const subscriptionSizingSchema = z.discriminatedUnion("sizingMode", [
  z.object({
    sizingMode: z.literal("fixed_usd"),
    fixedUsd: z.number().positive(),
  }),
  z.object({
    sizingMode: z.literal("pct_balance"),
    pctBalance: z.number().min(0.0001).max(1),
  }),
  z.object({
    sizingMode: z.literal("pct_leader_notional"),
    pctLeaderNotional: z.number().min(0.0001).max(100),
  }),
  z.object({
    sizingMode: z.literal("proportional_equity"),
    proportionalScale: z.number().min(0.01).max(10).optional().default(1),
  }),
]);

export const createSubscriptionSchema = z
  .object({
    address: ethAddress,
    label: z.string().max(200).optional(),
    active: z.boolean().optional().default(true),
    maxNotionalPerTrade: z.number().positive().optional(),
    maxOpenExposureUsd: z.number().positive().optional(),
    maxDailyLossUsd: z.number().positive().optional(),
    maxOrdersPerSecond: z.number().int().positive().max(50).optional(),
    maxSlippageBps: z.number().int().min(0).max(10_000).optional(),
  })
  .and(subscriptionSizingSchema);

export const updateSubscriptionSchema = z
  .object({
    label: z.string().max(200).optional().nullable(),
    active: z.boolean().optional(),
    sizingMode: sizingModeSchema.optional(),
    fixedUsd: z.number().positive().optional(),
    pctBalance: z.number().min(0.0001).max(1).optional(),
    pctLeaderNotional: z.number().min(0.0001).max(100).optional(),
    proportionalScale: z.number().min(0.01).max(10).optional(),
    maxNotionalPerTrade: z.number().positive().optional().nullable(),
    maxOpenExposureUsd: z.number().positive().optional().nullable(),
    maxDailyLossUsd: z.number().positive().optional().nullable(),
    maxOrdersPerSecond: z.number().int().positive().max(50).optional().nullable(),
    maxSlippageBps: z.number().int().min(0).max(10_000).optional().nullable(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.sizingMode === "fixed_usd" && data.fixedUsd == null) {
      ctx.addIssue({ code: "custom", message: "fixedUsd is required", path: ["fixedUsd"] });
    }
    if (data.sizingMode === "pct_balance" && data.pctBalance == null) {
      ctx.addIssue({ code: "custom", message: "pctBalance is required", path: ["pctBalance"] });
    }
    if (data.sizingMode === "pct_leader_notional" && data.pctLeaderNotional == null) {
      ctx.addIssue({
        code: "custom",
        message: "pctLeaderNotional is required",
        path: ["pctLeaderNotional"],
      });
    }
    if (data.sizingMode === "proportional_equity" && data.proportionalScale != null) {
      if (data.proportionalScale < 0.01 || data.proportionalScale > 10) {
        ctx.addIssue({
          code: "custom",
          message: "proportionalScale must be between 0.01 and 10",
          path: ["proportionalScale"],
        });
      }
    }
  });

export const engineStateUpdateSchema = z.object({
  paused: z.boolean().optional(),
  mode: z.enum(["read_only", "shadow", "live"]).optional(),
  cancelAllOnKill: z.boolean().optional(),
});

export type CreateSubscription = z.infer<typeof createSubscriptionSchema>;
