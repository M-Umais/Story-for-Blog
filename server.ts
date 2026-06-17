import express from "express";
import path from "path";
import fs from "fs";
import https from "https";
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

// Download and localize web fonts to prevent CORS errors during canvas rendering
async function downloadFonts() {
  const googleFontsCssUrl = "https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=JetBrains+Mono:wght@400;700&family=Bebas+Neue&family=Lora:ital,wght@0,400;0,700;1,400&family=Roboto:wght@400;700;900&family=Lato:wght@400;700;900&family=Poppins:wght@400;600;700;900&display=swap";

  const publicDir = path.join(process.cwd(), "public");
  const fontsDir = path.join(publicDir, "fonts");
  const cssOutputFile = path.join(publicDir, "fonts.css");

  // Ensure directories exist
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
  }
  if (!fs.existsSync(fontsDir)) {
    fs.mkdirSync(fontsDir, { recursive: true });
  }

  const fetchUrl = (url: string, headers: Record<string, string> = {}): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
      https.get(url, { headers }, (res) => {
        let data: Buffer[] = [];
        res.on('data', chunk => data.push(chunk));
        res.on('end', () => resolve(Buffer.concat(data)));
      }).on('error', reject);
    });
  };

  try {
    console.log("Downloading/updating system Google fonts locally...");
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36';
    const cssBuffer = await fetchUrl(googleFontsCssUrl, { 'User-Agent': userAgent });
    let cssText = cssBuffer.toString('utf8');

    const urlRegex = /url\((https:\/\/fonts\.gstatic\.com\/[^\)]+)\)/g;
    let match;
    const urlsToDownload: string[] = [];
    while ((match = urlRegex.exec(cssText)) !== null) {
      urlsToDownload.push(match[1]);
    }

    const uniqueUrls = [...new Set(urlsToDownload)];
    console.log(`Found ${uniqueUrls.length} unique font files to download.`);

    for (let i = 0; i < uniqueUrls.length; i++) {
      const url = uniqueUrls[i];
      const urlObj = new URL(url);
      const pathnameParts = urlObj.pathname.split('/');
      const originalFilename = pathnameParts[pathnameParts.length - 1];
      const safeFilename = `${i}_${originalFilename}`;
      const destinationPath = path.join(fontsDir, safeFilename);
      const localUrl = `/fonts/${safeFilename}`;

      if (!fs.existsSync(destinationPath)) {
        console.log(`[${i + 1}/${uniqueUrls.length}] Downloading font file ${originalFilename}...`);
        try {
          const fontBuffer = await fetchUrl(url);
          fs.writeFileSync(destinationPath, fontBuffer);
        } catch (downloadErr) {
          console.error(`Failed to download font file ${originalFilename}:`, downloadErr);
        }
      }
      cssText = cssText.split(url).join(localUrl);
    }

    fs.writeFileSync(cssOutputFile, cssText);
    
    // Copy to dist folder in production if dist already exists
    const distCssPath = path.join(process.cwd(), "dist", "fonts.css");
    const distFontsDir = path.join(process.cwd(), "dist", "fonts");
    if (fs.existsSync(path.join(process.cwd(), "dist"))) {
      if (!fs.existsSync(distFontsDir)) {
        fs.mkdirSync(distFontsDir, { recursive: true });
      }
      fs.writeFileSync(distCssPath, cssText);
      if (fs.existsSync(fontsDir)) {
        const files = fs.readdirSync(fontsDir);
        for (const file of files) {
          fs.copyFileSync(path.join(fontsDir, file), path.join(distFontsDir, file));
        }
      }
    }
    console.log("Fonts downloaded and CSS successfully localized at /fonts.css!");
  } catch (error) {
    console.error("Failed to download local fonts:", error);
  }
}

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

downloadFonts().then(() => setupVite()).then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
