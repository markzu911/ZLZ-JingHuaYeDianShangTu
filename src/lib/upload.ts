export async function persistResultImage(
  base64Image: string,
  fileName: string,
  userId: string,
  toolId: string,
  role?: number,
  token?: string,
  source: string = "serum-ai-e-com-generator"
): Promise<{ success: boolean; image?: any; error?: string }> {
  try {
    const imageData = base64Image.split(",")[1] || base64Image;
    const blob = await fetch(base64Image).then(r => r.blob());
    const fileSize = blob.size;

    // 1. Get Direct Token
    const tokenHeaders: any = { "Content-Type": "application/json" };
    if (token) tokenHeaders["Authorization"] = `Bearer ${token}`;

    const tokenRes = await fetch("/api/upload/direct-token", {
      method: "POST",
      headers: tokenHeaders,
      body: JSON.stringify({
        userId,
        toolId,
        role,
        source,
        mimeType: "image/png",
        fileName,
        fileSize
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.success) {
      return { success: false, error: tokenData.error || "Failed to get upload token" };
    }

    // 2. Upload to OSS
    const uploadHeaders: any = { ...(tokenData.headers || {}) };
    const uploadRes = await fetch(tokenData.uploadUrl, {
      method: tokenData.method || "PUT",
      headers: uploadHeaders,
      body: blob
    });

    if (!uploadRes.ok) {
      return { success: false, error: `OSS Upload failed: ${uploadRes.statusText}` };
    }

    // 3. Commit
    const commitRes = await fetch("/api/upload/commit", {
      method: "POST",
      headers: tokenHeaders,
      body: JSON.stringify({
        userId,
        toolId,
        role,
        source,
        objectKey: tokenData.objectKey,
        fileSize
      })
    });

    const commitData = await commitRes.json();
    if (!commitRes.ok || !commitData.success) {
      return { success: false, error: commitData.error || "Commit failed" };
    }

    return { success: true, image: commitData.image || commitData };
  } catch (err: any) {
    console.error("Persistence error:", err);
    return { success: false, error: err.message };
  }
}
