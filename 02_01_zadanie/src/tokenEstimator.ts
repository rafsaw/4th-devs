import { encodingForModel, getEncoding } from "js-tiktoken";
import type { TokenEstimate } from "./types.js";

export class TokenEstimator {
  private readonly encode: (text: string) => number[];

  constructor() {
    try {
      const encoding = encodingForModel("gpt-4o");
      this.encode = encoding.encode.bind(encoding);
    } catch {
      const encoding = getEncoding("cl100k_base");
      this.encode = encoding.encode.bind(encoding);
    }
  }

  estimate(text: string, limit: number): TokenEstimate {
    const tokens = this.encode(text).length;
    return {
      tokens,
      limit,
      withinLimit: tokens <= limit
    };
  }
}
