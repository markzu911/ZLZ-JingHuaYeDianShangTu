import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;
const RAW_SAAS_BASE = process.env.SAAS_API_BASE || process.env.VITE_SAAS_API_BASE || "https://gemini-proxy.aibigtree.com";
const SAAS_BASE = RAW_SAAS_BASE.includes("aibigtree.com") && !RAW_SAAS_BASE.includes("gemini-proxy") 
  ? RAW_SAAS_BASE.replace("aibigtree.com", "gemini-proxy.aibigtree.com") 
  : RAW_SAAS_BASE;
const APP_SOURCE = "serum-ai-e-com-generator";

app.use(express.json({ limit: '50mb' }));

// Gemini Config
const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || "DUMMY_KEY",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

const ANALYZE_MODEL = process.env.GEMINI_ANALYZE_MODEL || "gemini-3.5-flash";
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image-preview";

async function readUpstreamResponse(response: any) {
  const text = await response.text().catch(() => "");
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { text, data };
}

// 1. SaaS Proxy
app.all(['/api/tool/*', '/api/upload/*'], async (req, res) => {
  try {
    const saasUrl = `${SAAS_BASE}${req.url}`;
    console.log(`Forwarding request to: ${saasUrl} (${req.method})`);
    
    const response = await fetch(saasUrl, {
      method: req.method,
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': 'Serum-AI-Generator/1.0'
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0 ? JSON.stringify(req.body) : undefined,
    }).catch(err => {
      throw new Error(`SaaS connection failed: ${err.message}`);
    });

    const { text, data } = await readUpstreamResponse(response);
    if (data) return res.status(response.status).json(data);
    return res.status(response.status).json({
      success: response.ok,
      error: response.ok ? undefined : "SaaS upstream returned non-JSON response",
      detail: text,
      status: response.status
    });
  } catch (error: any) {
    console.error("Local SaaS Proxy Error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      detail: null,
      status: 500
    });
  }
});

// 2. Gemini Consolidated Endpoint
app.post("/api/gemini", async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      success: false,
      error: "Missing GEMINI_API_KEY on server",
      status: 500
    });
  }

  const { type, ...params } = req.body;

  try {
    if (type === 'analyze') {
      const { image } = params;
      const aiResponse = await ai.models.generateContent({
        model: ANALYZE_MODEL,
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
      
      let analysis = {};
      try {
        analysis = aiResponse.text ? JSON.parse(aiResponse.text) : {};
      } catch {
        return res.status(502).json({
          success: false,
          error: "Gemini returned invalid JSON",
          detail: aiResponse.text || ""
        });
      }
      return res.json({
        success: true,
        ...analysis
      });

    } else if (type === 'generate') {
      const { 
        userId, toolId, style, aspectRatio, imageSize, 
        productImage, perspective, title, description 
      } = params;

      const verifyUrl = `${SAAS_BASE}/api/tool/verify`;
      console.log(`Verifying user: ${verifyUrl}`);
      const verifyRes = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'User-Agent': 'Serum-AI-Generator/1.0'
        },
        body: JSON.stringify({ userId, toolId })
      }).catch(err => {
        console.error(`Fetch error at verify:`, err);
        return null;
      });

      if (!verifyRes) {
        return res.status(502).json({
          success: false,
          error: "Connection to SaaS failed at verify",
          status: 502
        });
      }

      const { text: verifyText, data: verify } = await readUpstreamResponse(verifyRes);
      if (!verifyRes.ok || !verify?.success) {
        console.warn("User verification failed:", verify || verifyText);
        return res.status(403).json({
          success: false,
          error: "User verification failed",
          detail: verify || verifyText || verifyRes.statusText,
          status: verifyRes.status
        });
      }

      // Generate
      const promptText = `Task: Professional e-commerce product enhancement.
Instructions:
1. Identify product in image.
2. Style: ${style}.
3. Perspective: ${perspective || 'default'}.
4. Context: ${title} - ${description}.
5. Realistic lighting, shadows, original product integrity. No text.`;

      const imageBase64Data = productImage.split(',')[1] || productImage;
      const aiResponse = await ai.models.generateContent({
        model: IMAGE_MODEL,
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
      if (!generatedBase64) {
        return res.status(500).json({
          success: false,
          error: "AI failed to generate image from prompt",
          detail: aiResponse,
          status: 500
        });
      }

      const imageBuffer = Buffer.from(generatedBase64, 'base64');
      const fileName = `${APP_SOURCE}_${Date.now()}.png`;

      // 3. Request Direct Token
      const tokenUrl = `${SAAS_BASE}/api/upload/direct-token`;
      console.log(`Requesting token: ${tokenUrl}`);
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'User-Agent': 'Serum-AI-Generator/1.0'
        },
        body: JSON.stringify({
          userId, 
          toolId, 
          source: APP_SOURCE, 
          mimeType: "image/png", 
          fileName, 
          fileSize: imageBuffer.length
        })
      }).catch(err => {
        console.error(`Fetch error at direct-token:`, err);
        return null;
      });

      if (!tokenRes) {
        return res.status(502).json({
          success: false,
          error: "Connection to SaaS failed at direct-token",
          status: 502
        });
      }

      const { text: tokenText, data: tokenJson } = await readUpstreamResponse(tokenRes);

      if (!tokenRes.ok || !tokenJson?.success && !tokenJson?.uploadUrl) {
        console.error("Direct token failed:", {
          status: tokenRes.status,
          body: tokenJson || tokenText
        });
        return res.status(502).json({
          success: false,
          error: "Failed to get OSS upload token from SaaS",
          detail: tokenJson || tokenText,
          status: tokenRes.status
        });
      }
      const tokenData = tokenJson;

      // 4. Upload to OSS
      console.log(`Uploading to OSS: ${tokenData.uploadUrl.split('?')[0]}`);
      const uploadRes = await fetch(tokenData.uploadUrl, {
        method: tokenData.method || 'PUT',
        headers: {
          ...(tokenData.headers || {}),
          'User-Agent': 'Serum-AI-Generator/1.0'
        },
        body: imageBuffer
      }).catch(err => {
        console.error(`Fetch error at OSS upload:`, err);
        return null;
      });

      if (!uploadRes) {
        return res.status(502).json({
          success: false,
          error: "Connection to OSS upload destination failed",
          status: 502
        });
      }

      if (!uploadRes.ok) {
        const uploadText = await uploadRes.text().catch(() => "");
        console.error("OSS upload failed:", uploadRes.status, uploadText);
        return res.status(502).json({
          success: false,
          error: "OSS upload failed with remote service",
          status: uploadRes.status,
          detail: uploadText
        });
      }

      // 5. Commit
      const commitUrl = `${SAAS_BASE}/api/upload/commit`;
      console.log(`Committing upload: ${commitUrl}`);
      const commitRes = await fetch(commitUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'User-Agent': 'Serum-AI-Generator/1.0'
        },
        body: JSON.stringify({ 
          userId, 
          toolId, 
          source: APP_SOURCE, 
          objectKey: tokenData.objectKey, 
          fileSize: imageBuffer.length 
        })
      }).catch(err => {
        console.error(`Fetch error at commit:`, err);
        return null;
      });

      if (!commitRes) {
        return res.status(502).json({
          success: false,
          error: "Connection to SaaS failed at commit",
          status: 502
        });
      }

      const { text: commitText, data: commitData } = await readUpstreamResponse(commitRes);

      if (!commitRes.ok || commitData?.success === false) {
        console.error("Commit failed:", {
          status: commitRes.status,
          body: commitData || commitText
        });
        return res.status(502).json({
          success: false,
          error: "Upload commit failed with SaaS",
          status: commitRes.status,
          detail: commitData || commitText
        });
      }

      // 6. Finally Consume Points (safely catch and log warnings)
      const consumeUrl = `${SAAS_BASE}/api/tool/consume`;
      console.log(`Consuming points: ${consumeUrl}`);
      const consumeRes = await fetch(consumeUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'User-Agent': 'Serum-AI-Generator/1.0'
        },
        body: JSON.stringify({ userId, toolId })
      }).catch(err => {
        console.warn(`Fetch error at consume (non-fatal):`, err);
        return null;
      });

      if (consumeRes) {
        const { text: consumeText, data: consume } = await readUpstreamResponse(consumeRes);
        if (!consumeRes.ok || consume?.success === false) {
          console.warn("Points consumption failed after success:", consume || consumeText);
        }
      } else {
        console.warn("Points consumption request failed, but image generation already succeeded.");
      }

      return res.json({
        success: true,
        image: commitData.image || commitData,
        generatedUrl: `data:image/png;base64,${generatedBase64}`
      });
    }
  } catch (error: any) {
    console.error("Gemini Local Error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message || "Internal server error during Gemini processing",
      detail: error.stack || null,
      status: 500
    });
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
