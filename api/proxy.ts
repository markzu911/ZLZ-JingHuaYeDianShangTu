import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";

const SAAS_BASE = "http://aibigtree.com";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

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
      const response = await fetch(saasUrl, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (error: any) {
      console.error("SaaS Proxy Error:", error);
      return res.status(500).json({ success: false, error: error.message });
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

        // Parallelize consume and token fetch to shave off a bit of time
        const [consumeRes, tokenRes] = await Promise.all([
          fetch(`${SAAS_BASE}/api/tool/consume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, toolId })
          }),
          fetch(`${SAAS_BASE}/api/upload/direct-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId, toolId, source: "result", mimeType: "image/png", 
              fileName: "generated.png", fileSize: imageBuffer.length
            })
          })
        ]);

        if (!consumeRes.ok) {
          const consume = await consumeRes.json();
          throw new Error(consume.message || "Points consumption failed");
        }

        if (!tokenRes.ok) throw new Error("Failed to get OSS upload token");
        const tokenData = await tokenRes.json();

        // 3. Upload to OSS (this is the bottleneck)
        await fetch(tokenData.uploadUrl, {
          method: 'PUT',
          headers: tokenData.headers || { 'Content-Type': 'image/png' },
          body: imageBuffer
        });

        // 4. Commit
        const commitRes = await fetch(`${SAAS_BASE}/api/upload/commit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            userId, toolId, source: "result", 
            objectKey: tokenData.objectKey, fileSize: imageBuffer.length 
          })
        });
        const commitData = await commitRes.json();

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
