import { and, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { AppError } from "@openloomi/shared/errors";
import { db } from "./queries";
import {
  affiliates,
  affiliateClicks,
  affiliateTransactions,
  affiliatePayouts,
  type Affiliate,
  type AffiliateInsert,
  type AffiliatePayout,
  user,
} from "./schema";

type AffiliateTransactionInsert = typeof affiliateTransactions.$inferInsert;
type AffiliatePayoutInsert = typeof affiliatePayouts.$inferInsert;

export type ListedAffiliate = Affiliate & { userEmail?: string | null };

export type { AffiliateClick } from "./schema";

export type AffiliateStatus = "pending" | "approved" | "rejected" | "disabled";
export type AffiliateTransactionStatus =
  | "pending"
  | "confirmed"
  | "reversed"
  | "paid";
export type AffiliatePayoutStatus =
  | "requested"
  | "approved"
  | "paid"
  | "failed";

function normalizeAffiliateCode(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) {
    throw new AppError("bad_request:api", "Affiliate code is required");
  }
  return trimmed.toUpperCase();
}

function normalizeCommissionRate(rate: number) {
  if (!Number.isFinite(rate)) {
    throw new AppError(
      "bad_request:api",
      "Commission rate must be a finite number",
    );
  }

  if (rate < 0) return 0;
  if (rate > 1) return 1;
  return Number(rate.toFixed(4));
}

function normalizeAmount(amount: number) {
  if (!Number.isFinite(amount)) {
    throw new AppError("bad_request:api", "Amount must be a finite number");
  }

  return Number((Math.round(amount * 100) / 100).toFixed(2));
}

export async function createAffiliate(
  payload: Omit<
    AffiliateInsert,
    "id" | "createdAt" | "updatedAt" | "metadata"
  > &
    Partial<Pick<AffiliateInsert, "metadata">>,
) {
  const now = new Date();
  const commissionRate = normalizeCommissionRate(payload.commissionRate ?? 0);
  const code = normalizeAffiliateCode(payload.code);
  const slug = payload.slug?.trim() || null;

  try {
    const [record] = await db
      .insert(affiliates)
      .values({
        userId: payload.userId ?? null,
        code,
        slug,
        commissionRate,
        status: (payload.status as AffiliateStatus | undefined) ?? "pending",
        metadata: payload.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return record;
  } catch (error) {
    console.error("[Affiliate] Failed to create affiliate", error);
    throw new AppError(
      "bad_request:database",
      "Unable to create affiliate record",
    );
  }
}

export async function updateAffiliate(
  affiliateId: string,
  updates: Partial<
    Pick<
      Affiliate,
      "commissionRate" | "status" | "slug" | "metadata" | "userId"
    >
  >,
) {
  if (Object.keys(updates).length === 0) {
    return null;
  }

  const payload: Partial<Affiliate> = {
    updatedAt: new Date(),
  } as Partial<Affiliate>;

  if (updates.commissionRate !== undefined) {
    payload.commissionRate = normalizeCommissionRate(updates.commissionRate);
  }

  if (updates.status) {
    payload.status = updates.status;
  }

  if (updates.slug !== undefined) {
    payload.slug = updates.slug?.trim() || null;
  }

  if (updates.metadata !== undefined) {
    payload.metadata = updates.metadata;
  }

  if (updates.userId !== undefined) {
    payload.userId = updates.userId;
  }

  try {
    const [record] = await db
      .update(affiliates)
      .set(payload)
      .where(eq(affiliates.id, affiliateId))
      .returning();

    return record ?? null;
  } catch (error) {
    console.error("[Affiliate] Failed to update affiliate", error);
    throw new AppError(
      "bad_request:database",
      "Unable to update affiliate record",
    );
  }
}

export async function getAffiliateById(affiliateId: string) {
  try {
    const [record] = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.id, affiliateId))
      .limit(1);
    return record ?? null;
  } catch (error) {
    console.error("[Affiliate] Failed to fetch affiliate by id", error);
    throw new AppError(
      "bad_request:database",
      "Unable to load affiliate record",
    );
  }
}

export async function getAffiliateByCode(code: string) {
  const normalized = normalizeAffiliateCode(code);
  try {
    const [record] = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.code, normalized))
      .limit(1);
    return record ?? null;
  } catch (error) {
    console.error("[Affiliate] Failed to fetch affiliate by code", error);
    throw new AppError(
      "bad_request:database",
      "Unable to load affiliate record",
    );
  }
}

export async function getAffiliateByUserId(userId: string) {
  try {
    const [record] = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.userId, userId))
      .limit(1);
    return record ?? null;
  } catch (error) {
    console.error("[Affiliate] Failed to fetch affiliate by user", error);
    throw new AppError(
      "bad_request:database",
      "Unable to load affiliate record by user",
    );
  }
}

export interface ListAffiliatesOptions {
  status?: AffiliateStatus | AffiliateStatus[];
  limit?: number;
  offset?: number;
}

export async function listAffiliates(options: ListAffiliatesOptions = {}) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const filters: SQL[] = [];

  if (Array.isArray(options.status)) {
    if (options.status.length > 0) {
      filters.push(inArray(affiliates.status, options.status));
    }
  } else if (options.status) {
    filters.push(eq(affiliates.status, options.status));
  }

  const whereClause: SQL | undefined =
    filters.length === 0
      ? undefined
      : filters.length === 1
        ? filters[0]
        : and(...filters);

  const selectQuery = db
    .select({
      affiliate: affiliates,
      userEmail: user.email,
    })
    .from(affiliates)
    .leftJoin(user, eq(affiliates.userId, user.id));

  const filteredSelectQuery = whereClause
    ? selectQuery.where(whereClause)
    : selectQuery;

  const rows = await filteredSelectQuery
    .orderBy(desc(affiliates.createdAt))
    .limit(limit)
    .offset(offset);

  const countQuery = db
    .select({ value: count(affiliates.id) })
    .from(affiliates);
  const filteredCountQuery = whereClause
    ? countQuery.where(whereClause)
    : countQuery;

  const [{ value: totalValue }] = await filteredCountQuery;

  const affiliatesList: ListedAffiliate[] = rows.map(
    ({ affiliate, userEmail }: any) => ({
      ...affiliate,
      userEmail,
    }),
  );

  return {
    affiliates: affiliatesList,
    total: Number(totalValue ?? 0),
    limit,
    offset,
  };
}

export async function getAffiliateBySlug(slug: string) {
  const normalized = slug.trim();
  if (!normalized) return null;

  try {
    const [record] = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.slug, normalized))
      .limit(1);
    return record ?? null;
  } catch (error) {
    console.error("[Affiliate] Failed to fetch affiliate by slug", error);
    throw new AppError(
      "bad_request:database",
      "Unable to load affiliate record",
    );
  }
}

export async function recordAffiliateClick(payload: {
  affiliateId: string;
  url?: string | null;
  referrer?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  try {
    const [record] = await db
      .insert(affiliateClicks)
      .values({
        affiliateId: payload.affiliateId,
        url: payload.url ?? null,
        referrer: payload.referrer ?? null,
        ipAddress: payload.ipAddress ?? null,
        userAgent: payload.userAgent ?? null,
        metadata: payload.metadata ?? null,
        createdAt: new Date(),
      })
      .returning();

    return record;
  } catch (error) {
    console.error("[Affiliate] Failed to log click", error);
    throw new AppError(
      "bad_request:database",
      "Unable to record affiliate click",
    );
  }
}

export interface AffiliateTransactionUpsertInput {
  affiliateId: string;
  orderId: string;
  userId?: string | null;
  subscriptionId?: string | null;
  planId?: string | null;
  currency: string;
  amount: number;
  commissionRate: number;
  commissionAmount: number;
  status?: AffiliateTransactionStatus;
  occurredAt?: Date;
  metadata?: Record<string, unknown> | null;
}

export async function upsertAffiliateTransaction(
  payload: AffiliateTransactionUpsertInput,
) {
  if (!payload.orderId) {
    throw new AppError(
      "bad_request:api",
      "orderId is required for affiliate transactions",
    );
  }

  const commissionRate = normalizeCommissionRate(payload.commissionRate);
  const amount = normalizeAmount(payload.amount);
  const commissionAmount = normalizeAmount(payload.commissionAmount);
  const normalizedCurrency = payload.currency.toUpperCase();
  const occurredAt = payload.occurredAt ?? new Date();
  const now = new Date();

  const insertValues: AffiliateTransactionInsert = {
    affiliateId: payload.affiliateId,
    subscriptionId: payload.subscriptionId ?? null,
    userId: payload.userId ?? null,
    orderId: payload.orderId,
    planId: payload.planId ?? null,
    currency: normalizedCurrency,
    amount,
    commissionRate,
    commissionAmount,
    status: payload.status ?? "pending",
    occurredAt,
    metadata: payload.metadata ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const updateSet: Partial<AffiliateTransactionInsert> = {
    affiliateId: payload.affiliateId,
    subscriptionId: payload.subscriptionId ?? null,
    userId: payload.userId ?? null,
    planId: payload.planId ?? null,
    currency: normalizedCurrency,
    amount,
    commissionRate,
    commissionAmount,
    occurredAt,
    updatedAt: now,
  };

  if (payload.status) {
    updateSet.status = payload.status;
  }

  if (payload.metadata !== undefined) {
    updateSet.metadata = payload.metadata ?? null;
  }

  try {
    const [record] = await db
      .insert(affiliateTransactions)
      .values(insertValues)
      .onConflictDoUpdate({
        target: affiliateTransactions.orderId,
        set: updateSet,
      })
      .returning();

    return record;
  } catch (error) {
    console.error("[Affiliate] Failed to upsert transaction", error);
    throw new AppError(
      "bad_request:database",
      "Unable to upsert affiliate transaction",
    );
  }
}

export async function setAffiliateTransactionStatus(
  transactionId: string,
  status: AffiliateTransactionStatus,
  metadata?: Record<string, unknown> | null,
) {
  const payload: Partial<AffiliateTransactionInsert> = {
    status,
    updatedAt: new Date(),
  };

  if (metadata !== undefined) {
    payload.metadata = metadata ?? null;
  }

  try {
    const [record] = await db
      .update(affiliateTransactions)
      .set(payload)
      .where(eq(affiliateTransactions.id, transactionId))
      .returning();

    return record ?? null;
  } catch (error) {
    console.error("[Affiliate] Failed to update transaction status", error);
    throw new AppError(
      "bad_request:database",
      "Unable to update affiliate transaction status",
    );
  }
}

export async function setAffiliateTransactionStatusByOrderId(
  orderId: string,
  status: AffiliateTransactionStatus,
  metadata?: Record<string, unknown> | null,
) {
  const payload: Partial<AffiliateTransactionInsert> = {
    status,
    updatedAt: new Date(),
  };

  if (metadata !== undefined) {
    payload.metadata = metadata ?? null;
  }

  try {
    const [record] = await db
      .update(affiliateTransactions)
      .set(payload)
      .where(eq(affiliateTransactions.orderId, orderId))
      .returning();

    return record ?? null;
  } catch (error) {
    console.error(
      "[Affiliate] Failed to update transaction status by order",
      error,
    );
    throw new AppError(
      "bad_request:database",
      "Unable to update affiliate transaction by order",
    );
  }
}

export async function assignTransactionsToPayout(
  payoutId: string,
  transactionIds: Array<string>,
) {
  if (transactionIds.length === 0) return [];

  try {
    const records = await db
      .update(affiliateTransactions)
      .set({
        payoutId,
        status: "paid",
        updatedAt: new Date(),
      })
      .where(inArray(affiliateTransactions.id, transactionIds))
      .returning();

    return records;
  } catch (error) {
    console.error("[Affiliate] Failed to attach transactions to payout", error);
    throw new AppError(
      "bad_request:database",
      "Unable to assign transactions to payout",
    );
  }
}

export interface AffiliatePayoutCreateInput {
  affiliateId: string;
  method: string;
  destinationDetails?: Record<string, unknown> | null;
  amount: number;
  currency?: string;
  status?: AffiliatePayoutStatus;
  remarks?: string | null;
  adminUserId?: string | null;
}

export async function createAffiliatePayout(
  payload: AffiliatePayoutCreateInput,
) {
  const amount = normalizeAmount(payload.amount);
  const currency = (payload.currency ?? "USD").toUpperCase();
  const now = new Date();

  const insertValues: AffiliatePayoutInsert = {
    affiliateId: payload.affiliateId,
    method: payload.method,
    destinationDetails: payload.destinationDetails ?? null,
    amount,
    currency,
    status: payload.status ?? "requested",
    remarks: payload.remarks ?? null,
    adminUserId: payload.adminUserId ?? null,
    requestedAt: now,
    processedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const [record] = await db
      .insert(affiliatePayouts)
      .values(insertValues)
      .returning();

    return record;
  } catch (error) {
    console.error("[Affiliate] Failed to create payout", error);
    throw new AppError(
      "bad_request:database",
      "Unable to create affiliate payout",
    );
  }
}

export async function updateAffiliatePayout(
  payoutId: string,
  updates: Partial<
    Pick<AffiliatePayout, "status" | "processedAt" | "remarks" | "adminUserId">
  >,
) {
  if (Object.keys(updates).length === 0) return null;

  const payload: Partial<AffiliatePayout> = {
    updatedAt: new Date(),
  } as Partial<AffiliatePayout>;

  if (updates.status) {
    payload.status = updates.status;
  }

  if (updates.processedAt !== undefined) {
    payload.processedAt = updates.processedAt ?? null;
  }

  if (updates.remarks !== undefined) {
    payload.remarks = updates.remarks ?? null;
  }

  if (updates.adminUserId !== undefined) {
    payload.adminUserId = updates.adminUserId;
  }

  try {
    const [record] = await db
      .update(affiliatePayouts)
      .set(payload)
      .where(eq(affiliatePayouts.id, payoutId))
      .returning();

    return record ?? null;
  } catch (error) {
    console.error("[Affiliate] Failed to update payout", error);
    throw new AppError(
      "bad_request:database",
      "Unable to update affiliate payout",
    );
  }
}

export async function listAffiliateTransactions(options: {
  affiliateId: string;
  status?: AffiliateTransactionStatus | AffiliateTransactionStatus[];
  limit?: number;
  offset?: number;
}) {
  const { affiliateId, status } = options;
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  try {
    const conditions: SQL[] = [
      eq(affiliateTransactions.affiliateId, affiliateId),
    ];

    if (Array.isArray(status)) {
      if (status.length > 0) {
        conditions.push(inArray(affiliateTransactions.status, status));
      }
    } else if (typeof status === "string") {
      conditions.push(eq(affiliateTransactions.status, status));
    }

    const whereClause: SQL =
      conditions.length === 1 ? conditions[0] : (and(...conditions) as SQL);

    const rows = await db
      .select()
      .from(affiliateTransactions)
      .where(whereClause)
      .orderBy(
        desc(affiliateTransactions.occurredAt),
        desc(affiliateTransactions.createdAt),
      )
      .limit(limit)
      .offset(offset);

    return rows;
  } catch (error) {
    console.error("[Affiliate] Failed to list transactions", error);
    throw new AppError(
      "bad_request:database",
      "Unable to list affiliate transactions",
    );
  }
}

export async function getAffiliatePayouts(affiliateId: string) {
  try {
    return await db
      .select()
      .from(affiliatePayouts)
      .where(eq(affiliatePayouts.affiliateId, affiliateId))
      .orderBy(affiliatePayouts.requestedAt);
  } catch (error) {
    console.error("[Affiliate] Failed to list payouts", error);
    throw new AppError(
      "bad_request:database",
      "Unable to list affiliate payouts",
    );
  }
}

export async function getAffiliatePayoutById(payoutId: string) {
  try {
    const [record] = await db
      .select()
      .from(affiliatePayouts)
      .where(eq(affiliatePayouts.id, payoutId))
      .limit(1);

    return record ?? null;
  } catch (error) {
    console.error("[Affiliate] Failed to fetch payout by id", error);
    throw new AppError(
      "bad_request:database",
      "Unable to load affiliate payout",
    );
  }
}

export interface ListAffiliatePayoutsOptions {
  status?: AffiliatePayoutStatus | AffiliatePayoutStatus[];
  affiliateId?: string;
  limit?: number;
  offset?: number;
}

export async function listAffiliatePayoutsAdmin(
  options: ListAffiliatePayoutsOptions = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const filters: SQL[] = [];

  if (options.affiliateId) {
    filters.push(eq(affiliatePayouts.affiliateId, options.affiliateId));
  }

  if (Array.isArray(options.status)) {
    if (options.status.length > 0) {
      filters.push(inArray(affiliatePayouts.status, options.status));
    }
  } else if (options.status) {
    filters.push(eq(affiliatePayouts.status, options.status));
  }

  const whereClause: SQL | undefined =
    filters.length === 0
      ? undefined
      : filters.length === 1
        ? filters[0]
        : and(...filters);

  const selectQuery = db
    .select({
      payout: affiliatePayouts,
      affiliate: affiliates,
      userEmail: user.email,
    })
    .from(affiliatePayouts)
    .leftJoin(affiliates, eq(affiliatePayouts.affiliateId, affiliates.id))
    .leftJoin(user, eq(affiliates.userId, user.id));

  const filteredSelectQuery = whereClause
    ? selectQuery.where(whereClause)
    : selectQuery;

  const rows = await filteredSelectQuery
    .orderBy(desc(affiliatePayouts.requestedAt))
    .limit(limit)
    .offset(offset);

  const countQuery = db
    .select({ value: count(affiliatePayouts.id) })
    .from(affiliatePayouts);
  const filteredCountQuery = whereClause
    ? countQuery.where(whereClause)
    : countQuery;

  const [{ value: totalValue }] = await filteredCountQuery;

  const payouts = rows.map(
    ({ payout, affiliate: affiliateRecord, userEmail }: any) => ({
      ...payout,
      affiliate: affiliateRecord,
      userEmail,
    }),
  );

  return {
    payouts,
    total: Number(totalValue ?? 0),
    limit,
    offset,
  };
}

export interface AffiliateBalanceSummary {
  pending: number;
  confirmed: number;
  payable: number;
  paid: number;
}

export async function getAffiliateBalanceSnapshot(
  affiliateId: string,
): Promise<AffiliateBalanceSummary> {
  try {
    const rows = await db
      .select({
        status: affiliateTransactions.status,
        total: sql<string>`COALESCE(SUM(${affiliateTransactions.commissionAmount}), 0)`,
      })
      .from(affiliateTransactions)
      .where(eq(affiliateTransactions.affiliateId, affiliateId))
      .groupBy(affiliateTransactions.status);

    const totals = (rows as any[]).reduce<Record<string, number>>(
      (acc: any, row: any) => {
        acc[row.status] = Number(row.total ?? 0);
        return acc;
      },
      {},
    );

    const confirmed = totals.confirmed ?? 0;
    const paid = totals.paid ?? 0;

    return {
      pending: totals.pending ?? 0,
      confirmed,
      payable: Math.max(confirmed - paid, 0),
      paid,
    };
  } catch (error) {
    console.error("[Affiliate] Failed to compute balance", error);
    throw new AppError(
      "bad_request:database",
      "Unable to compute affiliate balance",
    );
  }
}
