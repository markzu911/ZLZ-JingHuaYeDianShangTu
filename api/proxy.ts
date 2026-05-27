import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";

const SAAS_API_BASE = process.env.SAAS_API_BASE || process.env.VITE_SAAS_API_BASE || "https://aibigtree.com";

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || "DUMMY_KEY",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

const APP_SOURCE = "serum-ai-e-com-generator";

const ANALYZE_MODEL = process.env.GEMINI_ANALYZE_MODEL || "gemini-3.5-flash";
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image-preview";

function getApiPath(req: VercelRequest): string {
  const path = req.query?.path;
  if (Array.isArray(path)) return `/api/${path.join("/")}`;
  if (typeof path === "string") return `/api/${path}`;
  return (req.url || "").split("?")[0];
}

function normalizeBody(body: any) {
  if (!body) return {};
  return body;
}

async function readResponseSafe(response: Response) {
  const text = await response.text().catch(() => "");
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { text, data };
}

async function proxyToSaas(req: VercelRequest, res: VercelResponse, apiPath: string) {
  const upstreamUrl = `${SAAS_API_BASE.replace(/\/$/, "")}${apiPath}`;
  console.log(`Forwarding request to: ${upstreamUrl} (${req.method})`);

  const headers: any = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "Serum-AI-Generator/1.0",
  };

  if (req.headers["authorization"]) {
    headers["Authorization"] = req.headers["authorization"];
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(normalizeBody(req.body))
    });

    const { text, data } = await readResponseSafe(upstream);

    if (data) {
      return res.status(upstream.status).json(data);
    }

    return res.status(upstream.status).json({
      success: upstream.ok,
      error: upstream.ok ? undefined : "SaaS upstream returned non-JSON response",
      detail: text,
      status: upstream.status,
      upstreamUrl
    });
  } catch (error: any) {
    console.error(`SaaS Proxy Fetch Error (${apiPath}):`, error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to reach SaaS upstream",
      detail: null,
      status: 500,
      upstreamUrl
    });
  }
}

async function handleGemini(req: VercelRequest, res: VercelResponse) {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      success: false,
      error: "Missing GEMINI_API_KEY on server",
      status: 500
    });
  }

  const { type, ...params } = normalizeBody(req.body);

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
        userId, toolId, role, token, style, aspectRatio, imageSize, 
        productImage, perspective, title, description 
      } = params;

      const verifyUrl = `${SAAS_API_BASE.replace(/\/$/, "")}/api/tool/verify`;
      console.log(`Verifying user inside handleGemini: ${verifyUrl}`);
      
      const verifyHeaders: any = {
        'Content-Type': 'application/json',
        'User-Agent': 'Serum-AI-Generator/1.0'
      };
      if (token) {
        verifyHeaders['Authorization'] = `Bearer ${token}`;
      }

      const verifyRes = await fetch(verifyUrl, {
        method: 'POST',
        headers: verifyHeaders,
        body: JSON.stringify({ userId, toolId, role, token })
      }).catch(err => {
        console.error(`Fetch error at verify:`, err);
        return null;
      });

      if (!verifyRes) {
        return res.status(502).json({
          success: false,
          error: "Connection to SaaS failed at verify",
          status: 502,
          request: {
            verifyUrl,
            userId,
            toolId,
            role,
            hasToken: Boolean(token),
            saasApiBase: SAAS_API_BASE
          }
        });
      }

      const { text: verifyText, data: verify } = await readResponseSafe(verifyRes);
      if (!verifyRes.ok || !verify?.success) {
        console.warn("User verification failed backend:", verify || verifyText);
        return res.status(403).json({
          success: false,
          error: "User verification failed",
          detail: verify || verifyText || verifyRes.statusText,
          status: verifyRes.status || 403,
          request: {
            verifyUrl,
            userId,
            toolId,
            role,
            hasToken: Boolean(token),
            saasApiBase: SAAS_API_BASE
          }
        });
      }

      // Generate Background with Gemini Imagen
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

      // 3. Request Direct Token from SaaS Base
      const tokenUrl = `${SAAS_API_BASE.replace(/\/$/, "")}/api/upload/direct-token`;
      console.log(`Requesting upload token from: ${tokenUrl}`);
      const tokenHeaders: any = {
        'Content-Type': 'application/json',
        'User-Agent': 'Serum-AI-Generator/1.0'
      };
      if (token) {
        tokenHeaders['Authorization'] = `Bearer ${token}`;
      }
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: tokenHeaders,
        body: JSON.stringify({
          userId, 
          toolId, 
          role,
          token,
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

      const { text: tokenText, data: tokenJson } = await readResponseSafe(tokenRes);

      if (!tokenRes.ok || (!tokenJson?.success && !tokenJson?.uploadUrl)) {
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

      // 4. Upload to OSS Object Storage
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

      // 5. Commit upload state to SaaS Base
      const commitUrl = `${SAAS_API_BASE.replace(/\/$/, "")}/api/upload/commit`;
      console.log(`Committing upload to SaaS: ${commitUrl}`);
      const commitHeaders: any = {
        'Content-Type': 'application/json',
        'User-Agent': 'Serum-AI-Generator/1.0'
      };
      if (token) {
        commitHeaders['Authorization'] = `Bearer ${token}`;
      }
      const commitRes = await fetch(commitUrl, {
        method: 'POST',
        headers: commitHeaders,
        body: JSON.stringify({ 
          userId, 
          toolId, 
          role,
          token,
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

      const { text: commitText, data: commitData } = await readResponseSafe(commitRes);

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
      const consumeUrl = `${SAAS_API_BASE.replace(/\/$/, "")}/api/tool/consume`;
      console.log(`Consuming points on SaaS: ${consumeUrl}`);
      const consumeHeaders: any = {
        'Content-Type': 'application/json',
        'User-Agent': 'Serum-AI-Generator/1.0'
      };
      if (token) {
        consumeHeaders['Authorization'] = `Bearer ${token}`;
      }
      const consumeRes = await fetch(consumeUrl, {
        method: 'POST',
        headers: consumeHeaders,
        body: JSON.stringify({ userId, toolId, role, token })
      }).catch(err => {
        console.warn(`Fetch error at consume (non-fatal):`, err);
        return null;
      });

      if (consumeRes) {
        const { text: consumeText, data: consume } = await readResponseSafe(consumeRes);
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
    console.error("Gemini Endpoint Handler Error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error during Gemini processing",
      detail: error.stack || null,
      status: 500
    });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const apiPath = getApiPath(req);

  // 1. Direct API Path checking
  if (apiPath === '/api/gemini') {
    return handleGemini(req, res);
  }

  // 2. SaaS Proxy forwarding
  if (apiPath.startsWith('/api/tool/') || apiPath.startsWith('/api/upload/')) {
    return proxyToSaas(req, res, apiPath);
  }

  res.status(404).json({ error: `Route ${apiPath} not found` });
}
