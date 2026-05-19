import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from "node-fetch";

const SAAS_ORIGIN = process.env.SAAS_ORIGIN || "http://aibigtree.com";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Helper: Proxy to SaaS
async function callSaas(endpoint: string, body: any) {
  const response = await fetch(`${SAAS_ORIGIN}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { success: false, error: text.slice(0, 300) };
  }
  return data;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  const body = req.body;

  try {
    // 1. SaaS Proxy for tool endpoints
    if (pathname.startsWith('/api/tool/')) {
      const data = await callSaas(pathname, body);
      return res.status(200).json(data);
    }

    // 2. Analyze Product
    if (pathname === '/api/analyze') {
      if (!GEMINI_API_KEY) {
        return res.status(500).json({ success: false, message: "Missing GEMINI_API_KEY" });
      }

      const { userId, toolId, image } = body;
      
      // Verify Integral
      const verify = await callSaas("/api/tool/verify", { userId, toolId });
      if (!verify.success) return res.status(400).json(verify);

      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const base64Data = image.includes(',') ? image.split(',')[1] : image;
      const aiResponse = await model.generateContent([
        "Analyze this e-commerce product. Generate a professional product title, 1-3 core selling points, and a footer text. Return in STRICT JSON format: {\"title\": \"...\", \"sellingPoints\": [\"...\"], \"footer\": \"...\"}",
        { inlineData: { data: base64Data, mimeType: "image/png" } }
      ]);
      
      const text = aiResponse.response.text();
      const cleanJson = text.replace(/```json|```/g, "").trim();
      
      try {
        const result = JSON.parse(cleanJson);
        // Consume Integral
        await callSaas("/api/tool/consume", { userId, toolId });
        return res.status(200).json({ success: true, ...result });
      } catch (err) {
        return res.status(500).json({
          success: false,
          message: "Gemini did not return valid JSON",
          raw: cleanJson
        });
      }
    }

    // 3. Generate Image (Proxy/Mock for real generation)
    if (pathname === '/api/gemini' || pathname === '/api/generate') {
      const { userId, toolId, originalImage, style, ratio, resolution, perspective } = body;
      
      // Verify
      const verify = await callSaas("/api/tool/verify", { userId, toolId });
      if (!verify.success) return res.status(400).json(verify);

      // In a real scenario, you'd call Imagen or similar here.
      // For now, we'll continue the flow.
      await callSaas("/api/tool/consume", { userId, toolId });
      
      return res.status(200).json({ 
        success: true, 
        url: "https://via.placeholder.com/1024x1024?text=AI+Generated+Image+" + encodeURIComponent(perspective)
      });
    }

    // 4. Save Composed Image
    if (pathname === '/api/save-composed') {
      const { userId, toolId, image } = body;
      const buffer = Buffer.from(image.split(',')[1], 'base64');
      
      const token = await callSaas("/api/upload/direct-token", {
        userId, toolId, source: "result", mimeType: "image/png", fileSize: buffer.length
      });

      if (!token.success) throw new Error(token.error || "Token acquisition failed");

      const uploadUrl = token.uploadUrl || token.data?.uploadUrl;
      const objectKey = token.objectKey || token.data?.objectKey;

      const uploadRes = await fetch(uploadUrl, { 
        method: 'PUT', 
        body: buffer, 
        headers: { 'Content-Type': 'image/png' } 
      });

      if (!uploadRes.ok) throw new Error(`OSS Upload Failed: ${uploadRes.status}`);

      const commit = await callSaas("/api/upload/commit", {
        userId, toolId, source: "result", objectKey, fileSize: buffer.length
      });
      
      return res.status(200).json(commit);
    }

    res.status(404).json({ error: "Endpoint not found" });
  } catch (error: any) {
    console.error("Proxy Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
}
