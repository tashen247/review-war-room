/**
 * Second line of defence against prompt injection in review text.
 * The FIRST line is capability isolation (see src/agent/subagents.ts): agents that read
 * raw reviews have no Slack, Asana or verdict tools, and the lead never sees raw review text.
 */
const PATTERNS: RegExp[] = [
  /ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|prompts?|messages?)/i,
  /disregard (all |any )?(the )?(previous|prior|above|earlier|your)/i,
  /\b(system|developer) prompt\b/i,
  /\byou are now\b/i,
  /\b(post|send|reveal|print|leak|share|output|email)\b.{0,40}\b(api[ _-]?key|token|secret|password|credential|env(ironment)? var)/i,
  /<\/?\s*(system|instructions?|assistant|tool)\s*>/i,
  /\b(new|updated) instructions\s*:/i,
  /\bact as (an?|the) /i,
];

export interface InjectionScan { flagged: boolean; matches: string[]; sanitized: string }

export function scanForInjection(text: string): InjectionScan {
  const matches: string[] = [];
  let sanitized = text;
  for (const p of PATTERNS) {
    const g = new RegExp(p.source, p.flags.includes("g") ? p.flags : p.flags + "g");
    sanitized = sanitized.replace(g, (m) => { matches.push(m); return "[removed: instruction-like text]"; });
  }
  return { flagged: matches.length > 0, matches, sanitized };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** True when `payload` contains any `minLen`-character verbatim span of `source` (whitespace/case-insensitive). */
export function containsVerbatimSpan(payload: string, source: string, minLen = 40): boolean {
  const p = norm(payload), s = norm(source);
  if (s.length < minLen) return s.length >= 20 && p.includes(s);
  for (let i = 0; i + minLen <= s.length; i++) if (p.includes(s.slice(i, i + minLen))) return true;
  return false;
}

export class UnsafePayloadError extends Error {
  constructor(public reason: string) { super(`Refused outbound payload: ${reason}`); }
}

/**
 * Guard for outbound adapters (Slack, Asana). Refuses payloads that echo flagged review text
 * or contain instruction-like strings.
 */
export function assertSafeOutbound(payload: string, flaggedReviewTexts: string[]) {
  for (const t of flaggedReviewTexts) if (containsVerbatimSpan(payload, t)) throw new UnsafePayloadError("contains verbatim text from a review flagged as prompt injection");
  const scan = scanForInjection(payload);
  if (scan.flagged) throw new UnsafePayloadError(`instruction-like text: ${scan.matches[0]}`);
  if (/sk-ant-[A-Za-z0-9_-]{10,}|xox[abp]-[A-Za-z0-9-]{10,}/.test(payload)) throw new UnsafePayloadError("looks like a secret token");
}
