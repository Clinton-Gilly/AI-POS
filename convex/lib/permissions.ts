/**
 * Re-export of the shared permission vocabulary.
 *
 * The definitive list lives in `src/lib/auth/permissions.ts` so that the app
 * and the backend cannot drift apart — two lists would eventually disagree,
 * and the disagreement would be a silent authorization gap. Convex functions
 * import from here; React components import from `@/lib/auth/permissions`.
 */

export {
  PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLE_LABELS,
  isPermission,
  FINANCIAL_READ,
  type Permission,
  type SystemRoleKey,
} from "../../src/lib/auth/permissions";
