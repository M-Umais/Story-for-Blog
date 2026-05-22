import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini
let ai: GoogleGenAI | null = null;
function getAI() {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in environment variables.");
    }
    ai = new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return ai;
}

// API Routes
app.post("/api/split-story", async (req, res) => {
  try {
    const { story } = req.body;
    if (!story) {
      return res.status(400).json({ error: "Story content is required" });
    }

    const genAI = getAI();
    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Divide the following story into logically coherent chunks (pages) for a multi-page blog format. 
      Each chunk should be readable and not too long. 
      Provide a brief title for each chunk and a 'visualHint' which is a 3-5 word description of the mood or setting to guide visual design.
      
      Story:
      ${story}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Overall story title" },
            pages: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: "Chunk title" },
                  content: { type: Type.STRING, description: "The actual story text for this page" },
                  visualHint: { type: Type.STRING, description: "Mood or setting description" }
                },
                required: ["content", "visualHint"]
              }
            }
          },
          required: ["title", "pages"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    res.json(result);
  } catch (error: any) {
    console.error("Error splitting story:", error);
    res.status(500).json({ error: error.message || "Failed to split story" });
  }
});

// Vite middleware setup
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}

setupVite().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
