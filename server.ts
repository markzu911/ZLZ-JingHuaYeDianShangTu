import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const PORT = 3000;

// Middleware for parsing JSON with a larger limit for base64 images
app.use(express.json({ limit: '10mb' }));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
const SAAS_ORIGIN = process.env.SAAS_ORIGIN || "https://changzhou-saas.oss-cn-shanghai.aliyuncs.com"; // Placeholder, real one should be in .env

// SaaS API Helper
async function callSaas(endpoint: string, method: string, body: any) {
  const url = `${SAAS_ORIGIN}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 300) };
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.message || `SaaS Request Failed: ${response.status}`);
  }
  return data;
}

// 1. Launch Proxy
app.post("/api/tool/launch", async (req, res) => {
  try {
    const data = await callSaas("/api/tool/launch", "POST", req.body);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. Verify Proxy
app.post("/api/tool/verify", async (req, res) => {
  try {
    const data = await callSaas("/api/tool/verify", "POST", req.body);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. Main Generation Endpoint (Integrates AI + SaaS Lifecycle)
// 3. Main Generation Endpoint (Integrates AI + SaaS Lifecycle)
app.post("/api/save-composed", async (req, res) => {
  const { userId, toolId, image } = req.body;
  try {
    const imageBuffer = Buffer.from(image.split(',')[1] || image, 'base64');
    
    // SaaS Direct Token
    const tokenData = await callSaas("/api/upload/direct-token", "POST", {
      userId,
      toolId,
      source: "result",
      mimeType: "image/png",
      fileName: `composed_${Date.now()}.png`,
      fileSize: imageBuffer.byteLength
    });

    // OSS Upload
    const uploadRes = await fetch(tokenData.uploadUrl, {
      method: tokenData.method || 'PUT',
      headers: tokenData.headers,
      body: imageBuffer
    });

    if (!uploadRes.ok) throw new Error(`OSS Upload Failed: ${uploadRes.status}`);

    // SaaS Commit
    const commitData = await callSaas("/api/upload/commit", "POST", {
      userId,
      toolId,
      source: "result",
      objectKey: tokenData.objectKey,
      fileSize: imageBuffer.byteLength
    });

    res.json({ success: true, url: commitData.url || commitData.image?.url });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/generate", async (req, res) => {
  const { userId, toolId, originalImage, style, ratio, resolution, perspective } = req.body;

  try {
    // 1. Verify Integral
    await callSaas("/api/tool/verify", "POST", { userId, toolId });

    // 2. AI Generation
    const model = "gemini-3.1-flash-image-preview";
    const prompt = `Task: Professional e-commerce product enhancement.
Instructions:
1. Identify the specific product bottle/item in the provided image.
2. Maintain the environment and style described: ${style}.
3. Centrally integrate the identified product bottle into the scene, replacing any placeholder.
Perspective/Camera Angle: ${perspective}.
6. Ensure the product integration looks physically realistic with matching lighting and shadows.
7. CRITICAL: Maintain the exact original color, texture, shape, and branding of the product. Do not alter the uploaded product's appearance.
8. CRITICAL: Do NOT add any text overlays or watermarks. The output must be a clean photographic-style image ready for layout.`;

    const mimeType = originalImage.match(/data:([^;]+);/)?.[1] || "image/png";
    const base64Data = originalImage.split(',')[1] || originalImage;

    const aiResponse = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { data: base64Data, mimeType } },
          { text: prompt }
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: ratio,
          imageSize: resolution,
        },
      },
    });

    let generatedBase64 = "";
    for (const part of aiResponse.candidates?.[0]?.content.parts || []) {
      if (part.inlineData) {
        generatedBase64 = part.inlineData.data;
        break;
      }
    }

    if (!generatedBase64) throw new Error("AI failed to generate image data");

    const imageBuffer = Buffer.from(generatedBase64, 'base64');

    // 3. SaaS Consume
    await callSaas("/api/tool/consume", "POST", { userId, toolId });

    // 4. SaaS Direct Token
    const tokenData = await callSaas("/api/upload/direct-token", "POST", {
      userId,
      toolId,
      source: "result",
      mimeType: "image/png",
      fileName: `result_${Date.now()}.png`,
      fileSize: imageBuffer.byteLength
    });

    // 5. OSS Upload (Directly from backend as per requirement "工具后端直传 OSS")
    const uploadRes = await fetch(tokenData.uploadUrl, {
      method: tokenData.method || 'PUT',
      headers: tokenData.headers,
      body: imageBuffer
    });

    if (!uploadRes.ok) {
      throw new Error(`OSS Upload Failed: ${uploadRes.status}`);
    }

    // 6. SaaS Commit
    const commitData = await callSaas("/api/upload/commit", "POST", {
      userId,
      toolId,
      source: "result",
      objectKey: tokenData.objectKey,
      fileSize: imageBuffer.byteLength
    });

    // Return the SaaS URL to frontend
    res.json({
      success: true,
      url: commitData.url || commitData.image?.url,
      recordId: commitData.recordId || commitData.image?.recordId
    });

  } catch (error: any) {
    console.error("Generation Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Product Analysis Endpoint (moved to server for security/consistency)
app.post("/api/analyze", async (req, res) => {
  const { image } = req.body;
  try {
    const model = "gemini-3-flash-preview";
    const aiResponse = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          {
            inlineData: {
              data: image.split(',')[1] || image,
              mimeType: "image/png",
            },
          },
          {
            text: "Analyze this e-commerce product. Generate a professional product title, 1-3 core selling points, and a footer text. Return in JSON.",
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            sellingPoints: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            footer: { type: Type.STRING }
          },
          required: ["title", "sellingPoints"],
        },
      },
    });
    res.json(JSON.parse(aiResponse.text || "{}"));
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Vite middleware for development
async function startServer() {
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
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
