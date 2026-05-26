/// <reference types="vite/client" />
export interface AnalysisResult {
  title: string;
  sellingPoints: string[];
  footer?: string;
  layoutType?: 'center' | 'left' | 'right' | 'top' | 'bottom';
}

export async function analyzeProduct(base64Image: string): Promise<AnalysisResult> {
  const response = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      type: "analyze",
      image: base64Image 
    }),
  });
  
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = null;
  }

  if (!response.ok) {
    if (response.status === 504) {
      throw new Error("GENERATION_TIMEOUT_BUT_MAY_HAVE_SAVED");
    }
    const errorMessage = data?.detail?.message || data?.detail?.error || data?.error || "Analysis failed";
    throw new Error(errorMessage);
  }
  
  return data;
}

/**
 * Note: generateEcomBackground now is a more complex flow in the server.
 * However, to keep App.tsx largely unchanged, we'll implement a wrapper
 * that calls our new consolidated /api/gemini endpoint.
 */
export async function generateEcomBackground(
  style: string, 
  title: string, 
  description: string,
  aspectRatio: "1:1" | "3:4" | "4:3" | "16:9",
  imageSize: "1K" | "2K" | "4K",
  base64Product: string,
  perspective?: string,
  // New: SaaS context
  userId?: string,
  toolId?: string
): Promise<string> {
  const isDev = import.meta.env.DEV;
  const context = (window as any).SAAS_CONTEXT;
  const finalUserId = userId || context?.userId;
  const finalToolId = toolId || context?.toolId;

  if (!isDev && (!finalUserId || !finalToolId)) {
    throw new Error("未获取到 SaaS 用户上下文，请从 SaaS 平台入口打开工具");
  }

  const response = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "generate",
      userId: finalUserId || "dev_user",
      toolId: finalToolId || "dev_tool",
      style,
      title,
      description,
      aspectRatio,
      imageSize,
      productImage: base64Product,
      perspective
    }),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = null;
  }

  if (!response.ok) {
    if (response.status === 504) {
      throw new Error("GENERATION_TIMEOUT_BUT_MAY_HAVE_SAVED");
    }
    const errorMessage = data?.detail?.message || data?.detail?.error || data?.error || data?.detail || "Generation failed";
    throw new Error(errorMessage);
  }

  return data.generatedUrl;
}
