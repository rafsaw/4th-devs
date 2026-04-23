import type { Label, VerifyResult } from "./types.js";

const reactorPatterns = [/\breactor\b/i, /\bfuel rod\b/i];

const dangerPatterns = [
  /\bexplosive\b/i,
  /\bflammable\b/i,
  /\bradioactive\b/i,
  /\bcorrosive\b/i,
  /\btoxic\b/i,
  /\bweapon\b/i,
  /\bammunition\b/i,
  /\bbiohazard\b/i,
  /\buranium\b/i,
  /\bplutonium\b/i
];

export class LocalMockClassifier {
  classify(description: string): Label {
    // Reactor/fuel rod items are always NEU — this mirrors the task exception rule.
    if (reactorPatterns.some((p) => p.test(description))) {
      return "NEU";
    }
    return dangerPatterns.some((p) => p.test(description)) ? "DNG" : "NEU";
  }

  verify(prompt: string): VerifyResult {
    const description = prompt.split("\n").at(-1) ?? prompt;
    const label = this.classify(description);
    return {
      rawResponse: label,
      normalized: label
    };
  }
}
