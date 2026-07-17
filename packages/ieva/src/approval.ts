import type { ToolApproval } from "./types.ts";

/** Never require approval (the default when `approval` is omitted). */
export const never = (): ToolApproval => ({ mode: "never" });

/** Require approval the first time in a session, then remember the grant. */
export const once = (): ToolApproval => ({ mode: "once" });

/** Require approval on every call. */
export const always = (): ToolApproval => ({ mode: "always" });

export type { ApprovalDecision, ApprovalPolicy, ToolApproval } from "./types.ts";
