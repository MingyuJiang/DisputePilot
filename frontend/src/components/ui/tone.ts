import type { Tone } from "../../lib/statusModel";

/**
 * Tone → text colour. Pages pass a `Tone` from `statusModel`; they never pick
 * a colour themselves, so an unknown or warning state cannot be styled green.
 */
const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-ink",
  info: "text-info",
  pass: "text-pass",
  warn: "text-warn",
  stop: "text-stop",
};

export const toneTextClass = (tone: Tone): string => TONE_TEXT[tone];
