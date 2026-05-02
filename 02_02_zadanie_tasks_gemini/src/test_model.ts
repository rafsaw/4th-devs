import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config({ path: '../.env' });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function listModels() {
  try {
    // The listModels method is available in some versions of the SDK, but let's try a different approach if it's not.
    // In newer versions, it might be different. Let's try to just use a very safe model name.
    console.log("Testing with gemini-1.5-flash-8b...");
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-8b" });
    const result = await model.generateContent("test");
    console.log("Success with gemini-1.5-flash-8b");
  } catch (e: any) {
    console.error("Error:", e.message);
    if (e.status === 404) {
        console.log("404 suggests the model name is wrong or API version is unsupported.");
    }
  }
}
listModels();
