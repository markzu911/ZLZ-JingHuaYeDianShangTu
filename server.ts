import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

// SaaS Config
const SAAS_API_BASE = process.env.SAAS_API_BASE || "https://api.example.com";

// Gemini Config
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

/**
 * SaaS API Proxy Helpers
 */
async function callSaas(endpoint: string, method: string, body?: any) {
  const url = `${SAAS_API_BASE}${endpoint}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text.slice(0, 300) };
    }

    return { status: res.status, ok: res.ok, data };
  } catch (error: any) {
    console.error(`SaaS API Error (${endpoint}):`, error);
    return { ok: false, data: { error: error.message } };
  }
}

// A. Launch
app.post("/api/tool/launch", async (req, res) => {
  const { userId, toolId } = req.body;
  const result = await callSaas("/api/tool/launch", "POST", { userId, toolId });
  res.status(result.status || 500).json(result.data);
});

// B. Verify
app.post("/api/tool/verify", async (req, res) => {
  const { userId, toolId } = req.body;
  const result = await callSaas("/api/tool/verify", "POST", { userId, toolId });
  res.status(result.status || 500).json(result.data);
});

// C. Consume 
app.post("/api/tool/consume", async (req, res) => {
  const { userId, toolId } = req.body;
  const result = await callSaas("/api/tool/consume", "POST", { userId, toolId });
  res.status(result.status || 500).json(result.data);
});

// AI Endpoints
app.post("/api/analyze", async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: "No image provided" });

  try {
    const model = "gemini-3-flash-preview";
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { data: image.split(',')[1] || image, mimeType: "image/png" } },
          { text: "Analyze this e-commerce product. Generate a professional product title, 1-3 core selling points, and a footer text. Also suggest a poster layout type: 'center', 'left', 'right', 'top', or 'bottom' based on product shape." }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            sellingPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            footer: { type: Type.STRING },
            layoutType: { type: Type.STRING, enum: ['center', 'left', 'right', 'top', 'bottom'] }
          },
          required: ["title", "sellingPoints", "layoutType"]
        }
      }
    });
    res.json(JSON.parse(response.text || "{}"));
  } catch (error: any) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Full Generation and SaaS Save Flow
app.post("/api/generate-and-save", async (req, res) => {
  const { 
    userId, 
    toolId, 
    style, 
    aspectRatio, 
    imageSize, 
    productImage, 
    perspective,
    title,
    description
  } = req.body;

  if (!productImage || !userId || !toolId) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    const verify = await callSaas("/api/tool/verify", "POST", { userId, toolId });
    if (!verify.ok) return res.status(verify.status || 403).json(verify.data);

    const model = "gemini-3.1-flash-image-preview";
    const perspectivePrompt = perspective ? `Perspective/Camera Angle: ${perspective}.` : '';
    const promptText = `Task: Professional e-commerce product enhancement.
Instructions:
1. Identify the specific product bottle/item in the provided image.
2. Maintain the environment and style described: ${style}.
3. Centrally integrate the identified product bottle into the scene, replacing any placeholder.
${perspectivePrompt}
${title ? `4. Product Title Context: ${title}.` : ''}
${description ? `5. Product Description Context: ${description}.` : ''}
6. Ensure the product integration looks physically realistic with matching lighting and shadows.
7. CRITICAL: Maintain the exact original color, texture, shape, and branding of the product.
8. CRITICAL: Do NOT add any text overlays or watermarks.`;

    const mimeType = productImage.match(/data:([^;]+);/)?.[1] || "image/png";
    const imageBase64Data = productImage.split(',')[1] || productImage;

    const aiResponse = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { data: imageBase64Data, mimeType } },
          { text: promptText }
        ]
      },
      config: {
        // @ts-ignore - for image generation specific config
        imageConfig: { aspectRatio, imageSize }
      }
    });

    let generatedBase64 = "";
    for (const part of aiResponse.candidates?.[0]?.content.parts || []) {
      if (part.inlineData) {
        generatedBase64 = part.inlineData.data;
        break;
      }
    }

    if (!generatedBase64) throw new Error("AI failed to generate image");

    const consume = await callSaas("/api/tool/consume", "POST", { userId, toolId });
    if (!consume.ok) throw new Error("Points consumption failed");

    const imageBuffer = Buffer.from(generatedBase64, 'base64');
    const tokenRes = await callSaas("/api/upload/direct-token", "POST", {
      userId,
      toolId,
      source: "result",
      mimeType: "image/png",
      fileName: "generated-poster.png",
      fileSize: imageBuffer.length
    });

    if (!tokenRes.ok) throw new Error("Failed to get OSS upload token");
    const tokenData = tokenRes.data as any;

    const uploadRes = await fetch(tokenData.uploadUrl, {
      method: tokenData.method || 'PUT',
      headers: tokenData.headers || { 'Content-Type': 'image/png' },
      body: imageBuffer
    });

    if (!uploadRes.ok) throw new Error(`OSS Upload failed: ${uploadRes.status}`);

    const commitRes = await callSaas("/api/upload/commit", "POST", {
      userId,
      toolId,
      source: "result",
      objectKey: tokenData.objectKey,
      fileSize: imageBuffer.length
    });

    if (!commitRes.ok) throw new Error("Failed to commit image to database");

    const commitData = commitRes.data as any;
    res.json({
      success: true,
      image: commitData.image || commitData,
      generatedUrl: `data:image/png;base64,${generatedBase64}` 
    });

  } catch (error: any) {
    console.error("Generation flow error:", error);
    res.status(500).json({ error: error.message });
  }
});

// History / Query
app.get("/api/upload/image", async (req, res) => {
  const { userId, role } = req.query;
  const url = `/api/upload/image?userId=${userId}&role=${role}`;
  const result = await callSaas(url, "GET");
  res.status(result.status || 500).json(result.data);
});

// Delete
app.delete("/api/upload/image", async (req, res) => {
  const { id, userId, role } = req.body;
  const result = await callSaas("/api/upload/image", "DELETE", { id, userId, role });
  res.status(result.status || 500).json(result.data);
});

async function startServer() {
  // Vite Middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
