export interface AnalysisResult {
  title: string;
  sellingPoints: string[];
  footer?: string;
  layoutType?: 'center' | 'left' | 'right' | 'top' | 'bottom';
}

export async function analyzeProduct(base64Image: string): Promise<AnalysisResult> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: base64Image }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Analysis failed");
  }
  
  return response.json();
}

/**
 * Note: generateEcomBackground now is a more complex flow in the server.
 * However, to keep App.tsx largely unchanged, we'll implement a wrapper
 * that calls our new generate-and-save endpoint.
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
  const response = await fetch("/api/generate-and-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: userId || (window as any).SAAS_CONTEXT?.userId || "dev_user",
      toolId: toolId || (window as any).SAAS_CONTEXT?.toolId || "dev_tool",
      style,
      title,
      description,
      aspectRatio,
      imageSize,
      productImage: base64Product,
      perspective
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Generation failed");
  }

  const result = await response.json();
  // Return the generated base64 for immediate UI feedback, 
  // though it's also saved to SaaS OSS and DB now.
  return result.generatedUrl;
}
