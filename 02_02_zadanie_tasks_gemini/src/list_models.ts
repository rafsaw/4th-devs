import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config({ path: '../.env' });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function listModels() {
    const models = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).listModels(); // This is wrong, listModels is on the genAI object
    // Wait, the SDK has changed. Let me check the correct way.
}
// Checking documentation via tool is better.
