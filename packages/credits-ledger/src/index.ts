import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type CreditBalance,
  type CreditDebit,
  type CreditReservation,
  nowIso,
  stableId
} from "@motion-mcp/shared-types";

interface LedgerEntry {
  id: string;
  delta: number;
  reason: string;
  refId?: string;
  reservationId?: string;
  balanceAfter: number;
  createdAt: string;
}

interface LedgerState {
  plan: CreditBalance["plan"];
  credits: number;
  reservations: CreditReservation[];
  entries: LedgerEntry[];
}

const DEFAULT_FREE_CREDITS = 500;

export async function getCreditBalance(rootPath: string): Promise<CreditBalance> {
  const state = await readLedger(rootPath);
  return {
    credits: state.credits,
    plan: state.plan
  };
}

export async function consumeCredits(
  rootPath: string,
  debit: CreditDebit
): Promise<CreditBalance> {
  if (debit.amount <= 0) {
    return getCreditBalance(rootPath);
  }
  const state = await readLedger(rootPath);
  if (state.credits < debit.amount) {
    throw new Error(
      `Insufficient credits: need ${debit.amount}, available ${state.credits}.`
    );
  }
  state.credits -= debit.amount;
  state.entries.push({
    id: stableId("ledger", `${debit.reason}:${nowIso()}`),
    delta: -debit.amount,
    reason: debit.reason,
    refId: debit.refId,
    balanceAfter: state.credits,
    createdAt: nowIso()
  });
  await writeLedger(rootPath, state);
  return {
    credits: state.credits,
    plan: state.plan
  };
}

export async function reserveCredits(
  rootPath: string,
  debit: CreditDebit
): Promise<CreditReservation> {
  if (debit.amount <= 0) {
    throw new Error("Credit reservations must be greater than zero.");
  }
  const state = await readLedger(rootPath);
  if (state.credits < debit.amount) {
    throw new Error(
      `Insufficient credits: need ${debit.amount}, available ${state.credits}.`
    );
  }
  const reservation: CreditReservation = {
    reservationId: stableId("reservation", `${debit.reason}:${debit.refId ?? ""}:${nowIso()}`),
    amount: debit.amount,
    reason: debit.reason,
    refId: debit.refId,
    status: "reserved",
    createdAt: nowIso()
  };
  state.credits -= debit.amount;
  state.reservations.push(reservation);
  state.entries.push({
    id: stableId("ledger", `reserve:${reservation.reservationId}`),
    delta: -debit.amount,
    reason: `reserve:${debit.reason}`,
    refId: debit.refId,
    reservationId: reservation.reservationId,
    balanceAfter: state.credits,
    createdAt: nowIso()
  });
  await writeLedger(rootPath, state);
  return reservation;
}

export async function commitCreditReservation(
  rootPath: string,
  reservationId: string,
  reason = "commit reservation"
): Promise<CreditBalance> {
  const state = await readLedger(rootPath);
  const reservation = findReservation(state, reservationId);
  if (reservation.status !== "reserved") {
    throw new Error(`Reservation ${reservationId} is already ${reservation.status}.`);
  }
  reservation.status = "committed";
  reservation.completedAt = nowIso();
  state.entries.push({
    id: stableId("ledger", `commit:${reservationId}`),
    delta: 0,
    reason,
    refId: reservation.refId,
    reservationId,
    balanceAfter: state.credits,
    createdAt: nowIso()
  });
  await writeLedger(rootPath, state);
  return {
    credits: state.credits,
    plan: state.plan
  };
}

export async function refundCreditReservation(
  rootPath: string,
  reservationId: string,
  reason = "refund reservation"
): Promise<CreditBalance> {
  const state = await readLedger(rootPath);
  const reservation = findReservation(state, reservationId);
  if (reservation.status !== "reserved") {
    return {
      credits: state.credits,
      plan: state.plan
    };
  }
  reservation.status = "refunded";
  reservation.completedAt = nowIso();
  state.credits += reservation.amount;
  state.entries.push({
    id: stableId("ledger", `refund:${reservationId}`),
    delta: reservation.amount,
    reason,
    refId: reservation.refId,
    reservationId,
    balanceAfter: state.credits,
    createdAt: nowIso()
  });
  await writeLedger(rootPath, state);
  return {
    credits: state.credits,
    plan: state.plan
  };
}

export async function grantCredits(
  rootPath: string,
  amount: number,
  reason = "manual grant"
): Promise<CreditBalance> {
  const state = await readLedger(rootPath);
  state.credits += amount;
  state.entries.push({
    id: stableId("ledger", `${reason}:${nowIso()}`),
    delta: amount,
    reason,
    balanceAfter: state.credits,
    createdAt: nowIso()
  });
  await writeLedger(rootPath, state);
  return {
    credits: state.credits,
    plan: state.plan
  };
}

export function purchaseCreditsUrl(): { url: string } {
  const stripeCheckout = process.env.MOTION_MCP_STRIPE_CHECKOUT_URL;
  const stripePortal = process.env.MOTION_MCP_STRIPE_PORTAL_URL;
  return {
    url: stripeCheckout ?? stripePortal ?? "https://example.com/motion-mcp/billing"
  };
}

async function readLedger(rootPath: string): Promise<LedgerState> {
  const file = ledgerPath(rootPath);
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<LedgerState>;
    return {
      plan: parsed.plan ?? "local-dev",
      credits: parsed.credits ?? DEFAULT_FREE_CREDITS,
      reservations: parsed.reservations ?? [],
      entries: parsed.entries ?? []
    };
  } catch {
    const initial: LedgerState = {
      plan: "local-dev",
      credits: Number.parseInt(process.env.MOTION_MCP_INITIAL_CREDITS ?? "", 10) || DEFAULT_FREE_CREDITS,
      reservations: [],
      entries: [
        {
          id: "initial-local-dev-grant",
          delta: DEFAULT_FREE_CREDITS,
          reason: "initial local development grant",
          balanceAfter: DEFAULT_FREE_CREDITS,
          createdAt: nowIso()
        }
      ]
    };
    await writeLedger(rootPath, initial);
    return initial;
  }
}

async function writeLedger(rootPath: string, state: LedgerState): Promise<void> {
  const file = ledgerPath(rootPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function ledgerPath(rootPath: string): string {
  return path.join(path.resolve(rootPath), ".motion-mcp", "credits.json");
}

function findReservation(state: LedgerState, reservationId: string): CreditReservation {
  const reservation = state.reservations.find((candidate) => candidate.reservationId === reservationId);
  if (!reservation) {
    throw new Error(`Reservation ${reservationId} was not found.`);
  }
  return reservation;
}
