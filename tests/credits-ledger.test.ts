import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  commitCreditReservation,
  getCreditBalance,
  refundCreditReservation,
  reserveCredits
} from "../packages/credits-ledger/src/index.ts";

test("credit reservations commit without double-debiting", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "motion-mcp-ledger-"));
  try {
    const before = await getCreditBalance(root);
    const reservation = await reserveCredits(root, { amount: 40, reason: "test reserve" });
    const reserved = await getCreditBalance(root);
    assert.equal(reserved.credits, before.credits - 40);
    const committed = await commitCreditReservation(root, reservation.reservationId);
    assert.equal(committed.credits, before.credits - 40);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("credit reservations refund failed provider calls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "motion-mcp-ledger-"));
  try {
    const before = await getCreditBalance(root);
    const reservation = await reserveCredits(root, { amount: 55, reason: "test reserve" });
    const refunded = await refundCreditReservation(root, reservation.reservationId);
    assert.equal(refunded.credits, before.credits);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
