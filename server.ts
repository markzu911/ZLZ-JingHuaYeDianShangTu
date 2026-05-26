import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;
const SAAS_BASE = process.env.SAAS_API_BASE || process.env.VITE_SAAS_API_BASE || "https://aibigtree.com";
const APP_SOURCE = "serum-ai-e-com-generator";

app.use(express.json({ limit: '50mb' }));

// Gemini Config
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// 1. SaaS Proxy (matching Vercel proxy.ts logic)
app.all(['/api/tool/*', '/api/upload/*'], async (req, res) => {
  try {
    const saasUrl = `${SAAS_BASE}${req.url}`;
    const response = await fetch(saasUrl, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error: any) {
    console.error("Local SaaS Proxy Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Gemini Consolidated Endpoint
app.post("/api/gemini", async (req, res) => {
  const { type, ...params } = req.body;

  try {
    if (type === 'analyze') {
      const { image } = params;
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

    } else if (type === 'generate') {
      const { 
        userId, toolId, style, aspectRatio, imageSize, 
        productImage, perspective, title, description 
      } = params;

      // Verify
      const verifyRes = await fetch(`${SAAS_BASE}/api/tool/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, toolId })
      });
      const verify = await verifyRes.json();
      if (!verifyRes.ok || !verify.success) return res.status(403).json(verify);

      // Generate
      const model = "gemini-3.1-flash-image-preview";
      const promptText = `Task: Professional e-commerce product enhancement. Instructions: Identify product, style: ${style}, perspective: ${perspective || 'default'}, title: ${title}. No text overlays.`;
      const imageBase64Data = productImage.split(',')[1] || productImage;

      const aiResponse = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { data: imageBase64Data, mimeType: "image/png" } },
            { text: promptText }
          ]
        },
        config: {
          // @ts-ignore
          imageConfig: { aspectRatio, imageSize }
        }
      });

      let generatedBase64 = "";
      for (const part of aiResponse.candidates?.[0]?.content.parts || []) {
        if (part.inlineData) { generatedBase64 = part.inlineData.data; break; }
      }
      if (!generatedBase64) throw new Error("AI Generation failed");

      const imageBuffer = Buffer.from(generatedBase64, 'base64');
      const fileName = `${APP_SOURCE}_${Date.now()}.png`;

      // 3. Request Direct Token
      const tokenRes = await fetch(`${SAAS_BASE}/api/upload/direct-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId, 
          toolId, 
          source: APP_SOURCE, 
          mimeType: "image/png", 
          fileName, 
          fileSize: imageBuffer.length
        })
      });

      const tokenText = await tokenRes.text();
      let tokenJson: any = null;
      try { tokenJson = tokenText ? JSON.parse(tokenText) : null; } catch {}

      if (!tokenRes.ok || !tokenJson?.success && !tokenJson?.uploadUrl) {
        console.error("Direct token failed:", {
          status: tokenRes.status,
          statusText: tokenRes.statusText,
          body: tokenJson || tokenText,
          request: { userId, toolId, source: APP_SOURCE, fileName, fileSize: imageBuffer.length }
        });
        return res.status(502).json({
          success: false,
          error: "Failed to get OSS upload token",
          detail: tokenJson || tokenText,
          status: tokenRes.status
        });
      }
      const tokenData = tokenJson;

      // 4. Upload to OSS
      const uploadRes = await fetch(tokenData.uploadUrl, {
        method: tokenData.method || 'PUT',
        headers: tokenData.headers || { 'Content-Type': 'image/png' },
        body: imageBuffer
      });

      if (!uploadRes.ok) {
        const uploadText = await uploadRes.text().catch(() => "");
        console.error("OSS upload failed:", uploadRes.status, uploadText);
        return res.status(502).json({
          success: false,
          error: "OSS upload failed",
          status: uploadRes.status,
          detail: uploadText
        });
      }

      // 5. Commit
      const commitRes = await fetch(`${SAAS_BASE}/api/upload/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId, 
          toolId, 
          source: APP_SOURCE, 
          objectKey: tokenData.objectKey, 
          fileSize: imageBuffer.length 
        })
      });

      const commitText = await commitRes.text();
      let commitData: any = null;
      try { commitData = commitText ? JSON.parse(commitText) : null; } catch {}

      if (!commitRes.ok || commitData?.success === false) {
        console.error("Commit failed:", {
          status: commitRes.status,
          body: commitData || commitText
        });
        return res.status(502).json({
          success: false,
          error: "Upload commit failed",
          status: commitRes.status,
          detail: commitData || commitText
        });
      }

      // 6. Finally Consume Points
      const consumeRes = await fetch(`${SAAS_BASE}/api/tool/consume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, toolId })
      });

      if (!consumeRes.ok) {
        const consume = await consumeRes.json();
        console.warn("Points consumption failed after success:", consume.message);
      }

      res.json({
        success: true,
        image: commitData.image || commitData,
        generatedUrl: `data:image/png;base64,${generatedBase64}`
      });
    }
  } catch (error: any) {
    console.error("Gemini Local Error:", error);
    res.status(500).json({ error: error.message });
  }
});

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
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Development server running on http://localhost:${PORT}`);
  });
}

startServer();
