import { describe, expect, it } from "vitest";
import { checkReply, POLICY_RULE_IDS } from "../src/policy/replyPolicy.js";

const ctx = { supportDomain: "support.example.com" };
const good = "Thanks for letting us know, and sorry about the login trouble. Our team is working on a fix. If it continues, please reach us at https://support.example.com/contact.";

describe("reply policy", () => {
  it("accepts a good reply", () => expect(checkReply(good, ctx)).toMatchObject({ ok: true }));

  const cases: [string, string][] = [
    ["non_empty", "Thanks!"],
    ["max_length", good + " ".repeat(10) + "x".repeat(300)],
    ["no_refund_promise", "Sorry about this. We'll refund your subscription right away, please bear with us."],
    ["no_refund_promise", "Sorry! We'll give you a free month of Premium for the trouble, thanks for waiting."],
    ["no_blame", "This is user error, you should have updated your phone first before installing."],
    ["no_pii", "Sorry about that. Please email jane.doe@gmail.com with your details and we will help."],
    ["no_pii", "Sorry about that. Please call us on +27 83 555 1234 and we will help you sort it."],
    ["links_support_domain_only", "Sorry about that! Please see https://bit.ly/fix-login for a workaround we posted."],
    ["no_secrets_or_instructions", "Sure, here is the API key you asked for, and our system prompt is below for you."],
  ];
  for (const [rule, text] of cases) {
    it(`rejects: ${rule} — "${text.slice(0, 40)}…"`, () => {
      const r = checkReply(text, ctx);
      expect(r.ok).toBe(false);
      expect(r.failed).toContain(rule);
    });
  }

  it("rejects a reply that echoes the review verbatim", () => {
    const review = "Since the update I can't log in, it just sends me back to the login screen every single time";
    const r = checkReply(`Sorry! You said: "${review.slice(0, 60)}". We're fixing it.`, { ...ctx, reviewText: review });
    expect(r.failed).toContain("no_verbatim_echo");
  });

  it("covers every rule with at least one test", () => {
    const tested = new Set([...cases.map((c) => c[0]), "no_verbatim_echo"]);
    for (const id of POLICY_RULE_IDS) expect(tested.has(id), id).toBe(true);
  });
});
