import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from "@google/generative-ai";
import fetch from "node-fetch";

const SAAS_ORIGIN = "http://aibigtree.com";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenAI(GEMINI_API_KEY);

// 辅助函数：转发请求到 SaaS
async function proxyToSaas(endpoint: string, body: any) {
  const response = await fetch(`${SAAS_ORIGIN}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return await response.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 处理 CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { url } = req;
  const body = req.body;

  try {
    // 1. SaaS 接口转发 (/api/tool/*)
    if (url?.startsWith('/api/tool/')) {
      const data = await proxyToSaas(url, body);
      return res.status(200).json(data);
    }

    // 2. Gemini 生成接口 (/api/gemini 或 /api/generate)
    if (url === '/api/gemini' || url === '/api/generate') {
      const { userId, toolId, originalImage, style, ratio, resolution, perspective } = body;
      
      // 校验积分
      await proxyToSaas("/api/tool/verify", { userId, toolId });

      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `Task: Professional e-commerce product enhancement.
Instructions:
1. Maintain environment style: ${style}.
2. Camera perspective: ${perspective}.
3. Create a clean photographic context for the product.
4. Output should be clean and ready for advertising.`;

      const mimeType = originalImage.match(/data:([^;]+);/)?.[1] || "image/png";
      const base64Data = originalImage.split(',')[1] || originalImage;

      const aiResult = await model.generateContent([
        prompt,
        { inlineData: { data: base64Data, mimeType } }
      ]);
      
      // 注意：这里需要根据实际能够处理 Gemini 图片生成的逻辑来调整。
      // 为保持演示流程，我们返回一个模拟 URL，或者如果您有实际的生成逻辑请替换此处。
      
      await proxyToSaas("/api/tool/consume", { userId, toolId });
      
      return res.status(200).json({ success: true, url: "https://via.placeholder.com/1024x1024?text=AI+Generated+Result" });
    }

    // 3. 产品分析接口 (/api/analyze)
    if (url === '/api/analyze') {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const base64Data = body.image.includes(',') ? body.image.split(',')[1] : body.image;
      const aiResponse = await model.generateContent([
        "Analyze this e-commerce product. Generate a professional product title, 1-3 core selling points, and a footer text. Return in JSON.",
        { inlineData: { data: base64Data, mimeType: "image/png" } }
      ]);
      
      const text = aiResponse.response.text();
      const cleanJson = text.replace(/```json|```/g, "").trim();
      return res.status(200).json(JSON.parse(cleanJson));
    }

    // 4. 保存合成图 (/api/save-composed)
    if (url === '/api/save-composed') {
      const { userId, toolId, image } = body;
      const buffer = Buffer.from(image.split(',')[1], 'base64');
      
      const token = await proxyToSaas("/api/upload/direct-token", {
        userId, toolId, source: "result", mimeType: "image/png", fileSize: buffer.length
      });

      await fetch(token.data.uploadUrl, { method: 'PUT', body: buffer, headers: token.data.headers });
      const commit = await proxyToSaas("/api/upload/commit", {
        userId, toolId, source: "result", objectKey: token.data.objectKey, fileSize: buffer.length
      });
      
      return res.status(200).json(commit);
    }

    res.status(404).json({ error: "Endpoint not found" });
  } catch (error: any) {
    console.error("Proxy Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
}
