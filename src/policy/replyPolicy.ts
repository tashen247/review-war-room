import { containsVerbatimSpan, scanForInjection } from "./injection.js";

export const MAX_REPLY_CHARS = 350;

export const PII = {
  email: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  phone: /(\+?\d[\d\s().-]{7,}\d)/,
  card: /\b(?:\d[ -]?){13,19}\b/,
  saId: /\b\d{13}\b/,
};

const RULES: { id: string; test: (reply: string, ctx: PolicyContext) => boolean; message: string }[] = [
  { id: "non_empty", test: (r) => r.trim().length >= 20, message: "Reply is empty or too short (min 20 chars)." },
  { id: "max_length", test: (r) => r.length <= MAX_REPLY_CHARS, message: `Reply exceeds ${MAX_REPLY_CHARS} characters.` },
  {
    id: "no_refund_promise",
    test: (r) => !/\b(refund|money back|reimburs\w*|compensat\w*|free (month|months|premium|subscription|upgrade)|credit your account)\b/i.test(r),
    message: "Replies must not promise refunds, credits or compensation.",
  },
  {
    id: "no_blame",
    test: (r) => !/\b(your fault|user error|you (should have|must have|didn'?t|did not|failed to|forgot to)|you('re| are) (using|doing) it wrong|read the (manual|faq) first)\b/i.test(r),
    message: "Replies must not blame the user.",
  },
  {
    id: "no_pii",
    test: (r) => !Object.values(PII).some((re) => re.test(r)),
    message: "Reply contains personal data (email, phone, card or ID number).",
  },
  {
    id: "links_support_domain_only",
    test: (r, ctx) => {
      const urls = r.match(/\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+/gi) ?? [];
      return urls.every((u) => u.toLowerCase().replace(/^https?:\/\//, "").startsWith(ctx.supportDomain.toLowerCase()));
    },
    message: "Links are only allowed to the support domain.",
  },
  {
    id: "no_secrets_or_instructions",
    test: (r) => !/\b(api[ _-]?key|system prompt|access token|password is)\b/i.test(r) && !scanForInjection(r).flagged,
    message: "Reply mentions secrets or contains instruction-like text.",
  },
  {
    id: "no_verbatim_echo",
    test: (r, ctx) => !ctx.reviewText || !containsVerbatimSpan(r, ctx.reviewText, 40),
    message: "Reply echoes the review verbatim.",
  },
];

export interface PolicyContext { supportDomain: string; reviewText?: string }
export interface PolicyResult { ok: boolean; reasons: string[]; failed: string[] }

export function checkReply(reply: string, ctx: PolicyContext): PolicyResult {
  const failed = RULES.filter((rule) => !rule.test(reply, ctx));
  return { ok: failed.length === 0, reasons: failed.map((f) => f.message), failed: failed.map((f) => f.id) };
}

export const POLICY_RULE_IDS = RULES.map((r) => r.id);
