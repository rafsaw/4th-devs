import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config({ path: '../.env' });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export interface TileComparison {
    current: string[];
    target: string[];
}

export async function describeTilePair(currentPath: string, targetPath: string, retries = 3): Promise<TileComparison> {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `Analizujesz dwa fragmenty schematu elektrycznego: stan AKTUALNY oraz stan DOCELOWY dla tego samego pola (kafelka) 1x1.
Twoim zadaniem jest określenie krawędzi (top, right, bottom, left), przez które przechodzą jasne, świecące kable.

Ważne zasady:
1. To jest TEN SAM element (kabel lub elektrownia), tylko obrócony o wielokrotność 90 stopni.
2. Musi mieć TĘ SAMĄ LICZBĘ POŁĄCZEŃ w obu stanach. Jeśli widzisz np. 2 kable wchodzące do kafelka w stanie aktualnym, w docelowym też muszą być 2.
3. Niektóre kafelki to ELEKTROWNIE (mają napisy PWR... lub są źródłem). One również mają kable dochodzące do krawędzi.
4. Zwróć wynik WYŁĄCZNIE jako JSON:
{
  "current": ["edge1", "edge2"],
  "target": ["edge1", "edge2"]
}

Bądź bardzo uważny. Nawet mały, krótki odcinek kabla dochodzący do krawędzi się liczy.`;

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
        }
    ];
    
    for (let i = 0; i < retries; i++) {
        let text = "";
        try {
            const result = await model.generateContent([prompt, ...images]);
            const response = await result.response;
            text = response.text();
            const cleanText = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
            return JSON.parse(cleanText);
        } catch (e: any) {
            console.error(`Attempt ${i + 1} failed: ${e.message}`);
            if (i === retries - 1) throw e;
            await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
        }
    }
    throw new Error("Failed after retries");
}
