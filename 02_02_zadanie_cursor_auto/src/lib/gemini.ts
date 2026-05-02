import fs from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEY, geminiVisionModel } from "./env.js";

export type Edge = "top" | "right" | "bottom" | "left";

export type TileComparison = {
  current: Edge[];
  target: Edge[];
};

const genAI = () => new GoogleGenerativeAI(GEMINI_API_KEY());

export async function describeTilePair(
  currentPath: string,
  targetPath: string,
  retries = 3
): Promise<TileComparison> {
  const model = genAI().getGenerativeModel({ model: geminiVisionModel() });

  const prompt = `Two images of ONE cell in a 3x3 electricity puzzle.
Image 1 = CURRENT. Image 2 = TARGET (solved reference) for the same coordinates.

Task: list edges where a thick BLACK wire segment meets the inner square border.
Edges: top, right, bottom, left.

Hard rules:
- Same graph in both images (same number of connections). If one list has N edges, the other must have N.
- Typical N is 2 (bend/straight), 3 (T), or 1 (dead end). N=4 is rare (full cross).
- Ignore: beige background, grey title text, power-plant icons, PWR labels, noise outside the black wiring.
- A wire must visibly touch the cell border to count.

Return ONLY JSON (no markdown):
{"current":["top","right"],"target":["top","bottom"]}`;

  const images = [
    {
      inlineData: {
        data: Buffer.from(fs.readFileSync(currentPath)).toString("base64"),
        mimeType: "image/png",
      },
    },
    {
      inlineData: {
        data: Buffer.from(fs.readFileSync(targetPath)).toString("base64"),
        mimeType: "image/png",
      },
    },
  ];

  for (let i = 0; i < retries; i++) {
    try {
      const result = await model.generateContent([prompt, ...images]);
      const text = (await result.response).text();
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end === -1) throw new Error(`No JSON in model output: ${text}`);
      const parsed = JSON.parse(text.slice(start, end + 1)) as TileComparison;
      return parsed;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Gemini attempt ${i + 1}/${retries} failed: ${msg}`);
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error("Gemini failed after retries");
}
