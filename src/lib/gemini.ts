import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface AnalysisResult {
  title: string;
  sellingPoints: string[];
  footer?: string;
  layoutType?: 'center' | 'left' | 'right' | 'top' | 'bottom';
}

export async function analyzeProduct(base64Image: string): Promise<AnalysisResult> {
  const model = "gemini-3-flash-preview";
  
  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Image.split(',')[1] || base64Image,
            mimeType: "image/png",
          },
        },
        {
          text: "Analyze this e-commerce product. Generate a professional product title, 1-3 core selling points, and a footer text. Also suggest a poster layout type: 'center', 'left' (text on left), 'right' (text on right), 'top' (text on top half), or 'bottom' (text on bottom half) based on product shape and typically good advertising compositions.",
        },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          sellingPoints: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          footer: { type: Type.STRING },
          layoutType: { 
            type: Type.STRING,
            enum: ['center', 'left', 'right', 'top', 'bottom']
          }
        },
        required: ["title", "sellingPoints", "layoutType"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
}

export async function generateEcomBackground(
  style: string, 
  title: string, 
  description: string,
  aspectRatio: "1:1" | "3:4" | "4:3" | "16:9",
  imageSize: "1K" | "2K" | "4K",
  base64Product: string,
  perspective?: string
): Promise<string> {
  // Using gemini-3.1-flash-image-preview as requested
  const model = "gemini-3.1-flash-image-preview";
  
  const perspectivePrompt = perspective ? `Perspective/Camera Angle: ${perspective}.` : '';

  const prompt = `Task: Professional e-commerce product enhancement.
Instructions:
1. Identify the specific product bottle/item in the provided image.
2. Maintain the environment and style described: ${style}.
3. Centrally integrate the identified product bottle into the scene, replacing any placeholder.
${perspectivePrompt}
${title ? `4. Product Title Context: ${title}.` : ''}
${description ? `5. Product Description Context: ${description}.` : ''}
6. Ensure the product integration looks physically realistic with matching lighting and shadows.
7. CRITICAL: Maintain the exact original color, texture, shape, and branding of the product. Do not alter the uploaded product's appearance.
8. CRITICAL: Do NOT add any text overlays or watermarks. The output must be a clean photographic-style image ready for layout.`;

  const mimeType = base64Product.match(/data:([^;]+);/)?.[1] || "image/png";
  const data = base64Product.split(',')[1] || base64Product;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          {
            inlineData: {
              data,
              mimeType,
            },
          },
          {
            text: prompt,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio,
          imageSize,
        },
      },
    });

    for (const part of response.candidates?.[0]?.content.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    throw new Error("No image data in response");
  } catch (error: any) {
    console.error("Gemini Image Generation Error:", error);
    throw error;
  }
}
