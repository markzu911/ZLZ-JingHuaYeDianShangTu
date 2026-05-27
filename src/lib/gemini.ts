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
function getUnifiedSaasContext() {
  const context = (window as any).SAAS_CONTEXT || {};
  const params = new URLSearchParams(window.location.search);

  const rawUserId = context.userId || context.user_id || params.get("userId") || params.get("user_id");
  const rawToolId = context.toolId || context.tool_id || params.get("toolId") || params.get("tool_id");
  const rawRole = context.role || params.get("role");
  const rawToken = context.token || context.authorization || context.accessToken || params.get("token") || params.get("authorization") || params.get("accessToken");

  return {
    userId: rawUserId ? String(rawUserId).trim() : undefined,
    toolId: rawToolId ? String(rawToolId).trim() : undefined,
    role: rawRole ? Number(rawRole) : undefined,
    token: rawToken ? String(rawToken).trim() : undefined,
  };
}

function isValidSaasParam(v: string | undefined | null): boolean {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s !== "" && s !== "undefined" && s !== "null" && s !== "dev_user" && s !== "dev_tool";
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
  const context = getUnifiedSaasContext();
  const finalUserId = userId || context.userId;
  const finalToolId = toolId || context.toolId;
  const finalRole = context.role;
  const finalToken = context.token;

  console.log("generateEcomBackground: Calling /api/gemini with context:", {
    userId: finalUserId,
    toolId: finalToolId,
    role: finalRole,
    hasToken: Boolean(finalToken),
    hostname: window.location.hostname
  });

  const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  // Check validity inside production vs local
  if (!isLocal) {
    if (!isValidSaasParam(finalUserId) || !isValidSaasParam(finalToolId)) {
      alert("未获取到 SaaS 用户上下文，请从 SaaS 平台入口打开工具");
      throw new Error("未获取到 SaaS 用户上下文，请从 SaaS 平台入口打开工具");
    }
  } else {
    if (!finalUserId || !finalToolId || !isValidSaasParam(finalUserId) || !isValidSaasParam(finalToolId)) {
      alert("未获取到 SaaS 用户上下文，请从 SaaS 平台入口打开工具");
      throw new Error("未获取到 SaaS 用户上下文，请从 SaaS 平台入口打开工具");
    }
  }

  const reqHeaders: any = { "Content-Type": "application/json" };
  if (finalToken) {
    reqHeaders["Authorization"] = `Bearer ${finalToken}`;
  }

  const response = await fetch("/api/gemini", {
    method: "POST",
    headers: reqHeaders,
    body: JSON.stringify({
      type: "generate",
      userId: finalUserId,
      toolId: finalToolId,
      role: finalRole,
      token: finalToken,
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
    
    let errorMessage = "Generation failed";
    if (data) {
      if (typeof data.detail === "object" && data.detail !== null) {
        errorMessage = data.detail.message || data.detail.error || JSON.stringify(data.detail);
      } else {
        errorMessage = data.detail || data.error || data.message || "Generation failed";
      }
    }
    console.error("SaaS generate api failed:", data);
    throw new Error(errorMessage);
  }

  return data.generatedUrl;
}
