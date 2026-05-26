import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";

const RAW_SAAS_BASE = process.env.SAAS_API_BASE || process.env.VITE_SAAS_API_BASE || "https://gemini-proxy.aibigtree.com";
const SAAS_BASE = RAW_SAAS_BASE.includes("aibigtree.com") && !RAW_SAAS_BASE.includes("gemini-proxy") 
  ? RAW_SAAS_BASE.replace("aibigtree.com", "gemini-proxy.aibigtree.com") 
  : RAW_SAAS_BASE;
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
const APP_SOURCE = "serum-ai-e-com-generator";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. CORS Configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { url = '' } = req;
  const path = url.split('?')[0];

  // 2. Handle SaaS Tool Requests (Forwarding)
  if (path.startsWith('/api/tool/') || path.startsWith('/api/upload/')) {
    try {
      const saasUrl = `${SAAS_BASE}${url}`;
      console.log(`Forwarding request to: ${saasUrl} (${req.method})`);
      
      const response = await fetch(saasUrl, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Serum-AI-Generator/1.0',
        },
        body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (error: any) {
      console.error(`SaaS Proxy Fetch Error (${url}):`, error);
      return res.status(500).json({ 
        success: false, 
        error: error.message,
        url: `${SAAS_BASE}${url}`
      });
    }
  }

  // 3. Handle Gemini Generation
  if (path === '/api/gemini' && req.method === 'POST') {
    const { type, ...params } = req.body;

    try {
      if (type === 'analyze') {
        const { image } = params;
        const model = "gemini-3-flash-preview";
        const aiResponse = await ai.models.generateContent({
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
        return res.json(JSON.parse(aiResponse.text || "{}"));

      } else if (type === 'generate') {
         // Full generation + SaaS save flow logic
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
          throw new Error(`Connection to SaaS failed at verify: ${err.message}`);
        });

        const verify = await verifyRes.json();
        if (!verifyRes.ok || !verify.success) {
          console.warn("User verification failed:", verify);
          return res.status(403).json(verify);
        }

        // Generate
        const model = "gemini-3.1-flash-image-preview";
        const promptText = `Task: Professional e-commerce product enhancement.
Instructions:
1. Identify product in image.
2. Style: ${style}.
3. Perspective: ${perspective || 'default'}.
4. Context: ${title} - ${description}.
5. Realistic lighting, shadows, original product integrity. No text.`;

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
        if (!generatedBase64) throw new Error("AI failed to generate image");

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
          throw new Error(`Connection to SaaS failed at direct-token: ${err.message}`);
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
          throw new Error(`Connection to OSS failed: ${err.message}`);
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
          throw new Error(`Connection to SaaS failed at commit: ${err.message}`);
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

        // 6. Finally Consume Points (only if everything else succeeded)
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
          return null; // Don't fail the whole request
        });

        if (!consumeRes.ok) {
          const consume = await consumeRes.json();
          console.warn("Points consumption failed after success:", consume.message);
          // We don't fail the whole request here since the image is already saved,
          // but we could if strict enforcement is needed.
        }

        return res.json({
          success: true,
          image: commitData.image || commitData,
          generatedUrl: `data:image/png;base64,${generatedBase64}`
        });
      }
    } catch (error: any) {
      console.error("Gemini Proxy Error:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  res.status(404).json({ error: "Route not found" });
}
