/**
 * Scheduled jobs.
 *
 * Times are UTC. East African Time is UTC+3, so 22:00 UTC is 01:00 local —
 * comfortably after a shop closes and before it opens, which is when a
 * reconciliation that may correct stock counts should run.
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * The inventory invariant check. Should always find zero drift; a non-zero
 * result means a write path bypassed applyMovement. See docs/RISKS.md R4.
 */
crons.cron(
  "reconcile inventory",
  "0 22 * * *",
  internal.platform.maintenance.reconcileInventory,
  {},
);

/**
 * Low-stock alerts, twice a day: early morning so an owner can order before
 * suppliers close, and mid-afternoon to catch a heavy trading day.
 */
crons.cron(
  "scan low stock",
  "0 4,13 * * *",
  internal.platform.maintenance.scanLowStock,
  {},
);

export default crons;
