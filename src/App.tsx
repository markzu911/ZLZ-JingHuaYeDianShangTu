/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Upload,
  Sparkles,
  Download,
  Image as ImageIcon,
  Trash2,
  History,
  Check,
  ChevronRight,
  Maximize2,
  RefreshCw,
  Monitor,
  Coins,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  analyzeProduct,
  generateEcomBackground,
  AnalysisResult,
} from "./lib/gemini.ts";
import { persistResultImage } from "./lib/upload.ts";
import * as htmlToImage from "html-to-image";

interface SellingPoint {
  id: string;
  text: string;
}

interface GeneratedItem {
  id: string;
  originalImage: string;
  generatedImage: string;
  title: string;
  sellingPoints: SellingPoint[];
  footer?: string;
  style: string;
  ratio: string;
  resolution: string;
  timestamp: string;
}

interface AnalysisResultExtended {
  title: string;
  sellingPoints: SellingPoint[];
  footer?: string;
}

const STYLES = [
  {
    id: "high-tech",
    name: "高端科技",
    prompt:
      "Replica of premium scientific aesthetic: The product is positioned centrally within the frame. The background consists of elegant flowing golden liquid ribbons and waves with integrated digital glowing particle grids and luminous micro-points. Use soft golden cinematic lighting. IDENTIFY THE PRODUCT IN THE ATTACHED IMAGE AND PLACE IT IN THIS SCENE. Keep the golden wave environment exactly as described while seamlessly integrating the product.",
  },
  {
    id: "luxury",
    name: "轻奢黄金",
    prompt:
      "Premium luxury gold aesthetic: The background features sparkling, shimmering golden sand and fine glitter. A smooth, glossy wave of molten liquid gold flows gracefully at one edge. Several elegant metallic golden leaves with distinct veins are scattered around. The scene is illuminated with dramatic, magical lighting including bright glowing sparkles, subtle lens flares, and soft bokeh. IDENTIFY THE UPLOADED PRODUCT AND INTEGRATE IT INTO THIS SHIMMERING GOLDEN ENVIRONMENT as the main subject. Ensure realistic lighting, shadows, and reflections. Do not alter the original product design.",
  },
];

const TEXT_COLORS = [
  { id: "", name: "自动" },
  { id: "text-slate-800 drop-shadow-sm", name: "简约黑" },
  { id: "text-white drop-shadow-md", name: "纯净白" },
  { id: "text-[#facc15] drop-shadow-md", name: "日光黄" },
  {
    id: "bg-gradient-to-b from-yellow-100 via-yellow-400 to-yellow-600 bg-clip-text text-transparent drop-shadow-[0_3px_6px_rgba(0,0,0,0.4)]",
    name: "黄金渐变",
  },
  {
    id: "bg-gradient-to-b from-slate-100 via-slate-300 to-slate-500 bg-clip-text text-transparent drop-shadow-[0_2px_5px_rgba(0,0,0,0.3)]",
    name: "白银渐变",
  },
  {
    id: "bg-gradient-to-r from-rose-200 via-rose-400 to-rose-600 bg-clip-text text-transparent drop-shadow-[0_2px_5px_rgba(0,0,0,0.3)]",
    name: "玫瑰渐变",
  },
];

const PERSPECTIVES = [
  {
    id: "top-left",
    name: "俯视高位",
    prompt:
      "The product stands upright, shot from a top-left diagonal 45-degree high angle perspective. Ensure it integrates perfectly with the background environment.",
  },
  {
    id: "frontal",
    name: "平视正面",
    prompt:
      "The product is tilted at a 45-degree angle, frontal eye-level cinematic shot. Ensure realistic lighting and contact shadows.",
  },
  {
    id: "flat-lay",
    name: "平躺俯拍",
    prompt:
      "A bird's-eye view flat-lay shot, the product is centered and lying completely flat on the surface of the environment.",
  },
];

const RATIOS = ["1:1", "3:4", "4:3", "16:9"];
const RESOLUTIONS = ["1K", "2K", "4K"];
const APP_SOURCE = "serum-ai-e-com-generator";

export default function App() {
  // State
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResultExtended>({
    title: "",
    sellingPoints: [],
    footer: "",
  });
  const [selectedStyle, setSelectedStyle] = useState(STYLES[0]);
  const [selectedPerspective, setSelectedPerspective] = useState(
    PERSPECTIVES[0],
  );
  const [selectedRatio, setSelectedRatio] = useState("3:4");
  const [selectedResolution, setSelectedResolution] = useState("1K");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [history, setHistory] = useState<GeneratedItem[]>([]);
  const [activeTab, setActiveTab] = useState<"settings" | "result">("settings");
  const [isDarkBg, setIsDarkBg] = useState(false);
  const [selectedTextColor, setSelectedTextColor] = useState<string>("");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // SaaS Context state
  const [saasContext, setSaasContext] = useState<any>(null);
  const [userIntegral, setUserIntegral] = useState<number | null>(null);

  const resetSession = useCallback(() => {
    setOriginalImage(null);
    setGeneratedImages([]);
    setSelectedImageIndex(0);
    setHistory([]);
    setAnalysis({ title: "", sellingPoints: [] });
    setActiveTab("settings");
  }, []);

  const getUnifiedContext = useCallback((input?: any) => {
    const parentContext = (window as any).SAAS_CONTEXT || {};
    const params = new URLSearchParams(window.location.search);

    const rawUserId = input?.userId || input?.user_id || input?.data?.userId || input?.data?.user_id || params.get("userId") || params.get("user_id") || parentContext.userId || parentContext.user_id;
    const rawToolId = input?.toolId || input?.tool_id || input?.data?.toolId || input?.data?.tool_id || params.get("toolId") || params.get("tool_id") || parentContext.toolId || parentContext.tool_id;
    const rawRole = input?.role || input?.data?.role || params.get("role") || parentContext.role;
    const rawToken = input?.token || input?.data?.token || input?.authorization || input?.data?.authorization || input?.accessToken || input?.data?.accessToken || params.get("token") || params.get("authorization") || params.get("accessToken") || parentContext.token || parentContext.authorization || parentContext.accessToken;

    return {
      userId: rawUserId ? String(rawUserId).trim() : undefined,
      toolId: rawToolId ? String(rawToolId).trim() : undefined,
      role: rawRole ? Number(rawRole) : undefined,
      token: rawToken ? String(rawToken).trim() : undefined,
    };
  }, []);

  const initSaas = useCallback(
    async (contextRaw: any) => {
      resetSession();
      const context = getUnifiedContext(contextRaw);
      setSaasContext(context);
      (window as any).SAAS_CONTEXT = context;

      if (!context.userId || !context.toolId) {
        console.warn("Unified context missing userId or toolId:", context);
        return;
      }

      try {
        const headers: any = { "Content-Type": "application/json" };
        if (context.token) {
          headers["Authorization"] = `Bearer ${context.token}`;
        }
        const res = await fetch("/api/tool/launch", {
          method: "POST",
          headers,
          body: JSON.stringify({
            userId: context.userId,
            toolId: context.toolId,
            role: context.role,
            token: context.token
          }),
        });
        const text = await res.text().catch(() => "");
        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {}
        if (!data) {
          data = { success: false, error: "Empty or invalid response from server", detail: text };
        }
        if (data.success && data.data?.user?.integral !== undefined) {
          setUserIntegral(data.data.user.integral);
          setSaasContext((prev: any) => ({ ...prev, ...data.data.user }));
        }
      } catch (err) {
        console.error("Launch error:", err);
      }
    },
    [resetSession, getUnifiedContext]
  );

  useEffect(() => {
    // 1. Handle postMessage initialization
    const handleSaasMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data) return;

      if (data.type === "SAAS_INIT" || data.userId || data.user_id || data.toolId || data.tool_id) {
        console.log("SaaS Initialized via message event:", data);
        initSaas(data);
      }
    };

    window.addEventListener("message", handleSaasMessage);

    // 2. Fallback check window.SAAS_CONTEXT or URL location query
    const initialContext = getUnifiedContext();
    if (initialContext.userId && initialContext.toolId) {
      console.log("SaaS Context identified on mount:", initialContext);
      initSaas(initialContext);
    }

    return () => window.removeEventListener("message", handleSaasMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentTextColor = selectedTextColor
    ? selectedTextColor
    : isDarkBg
      ? "text-white"
      : "text-slate-800";
  const generatedImageUrl = generatedImages[selectedImageIndex] || null;

  const resultContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (generatedImageUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = 100;
        c.height = 100;
        const ctx = c.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, 100, 100);
          const data = ctx.getImageData(0, 0, 100, 100).data;
          let brightness = 0;
          for (let i = 0; i < data.length; i += 4) {
            brightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
          }
          brightness = brightness / (100 * 100);
          setIsDarkBg(brightness < 128);
        }
      };
      img.src = generatedImageUrl;
    }
  }, [generatedImageUrl]);

  // Handlers
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setOriginalImage(event.target?.result as string);
        setGeneratedImages([]);
        setAnalysis({ title: "", sellingPoints: [] });
        setActiveTab("settings");
      };
      reader.readAsDataURL(file);
    }
  };

  const addSellingPoint = () => {
    const newPoint: SellingPoint = {
      id: Math.random().toString(36).substr(2, 9),
      text: "新核心卖点",
    };
    setAnalysis((prev) => ({
      ...prev,
      sellingPoints: [...prev.sellingPoints, newPoint],
    }));
  };

  const removeSellingPoint = (id: string) => {
    setAnalysis((prev) => ({
      ...prev,
      sellingPoints: prev.sellingPoints.filter((p) => p.id !== id),
    }));
  };

  const updateSellingPointText = (id: string, text: string) => {
    setAnalysis((prev) => ({
      ...prev,
      sellingPoints: prev.sellingPoints.map((p) =>
        p.id === id ? { ...p, text } : p,
      ),
    }));
  };

  const saveToHistory = (item: GeneratedItem) => {
    setHistory((prev) => [item, ...prev].slice(0, 30));
  };

  const wrapHistoryItem = (
    image: string,
    itemAnalysis: AnalysisResultExtended,
  ) => {
    return {
      id: Math.random().toString(36).substr(2, 9),
      originalImage: originalImage!,
      generatedImage: image,
      title: itemAnalysis.title,
      sellingPoints: itemAnalysis.sellingPoints,
      footer: itemAnalysis.footer,
      style: selectedStyle.name,
      ratio: selectedRatio,
      resolution: selectedResolution,
      timestamp: new Date().toLocaleTimeString(),
    };
  };

  const handleGenerate = async () => {
    if (!originalImage) return;

    const { userId, toolId, role, token } = saasContext || {};
    if (!userId || !toolId) {
      alert("未获取到 SaaS 用户上下文，请从 SaaS 平台入口打开工具");
      return;
    }

    setIsGenerating(true);
    setActiveTab("result");
    setGeneratedImages([]);
    setSelectedImageIndex(0);

    try {
      // 1. Verify
      const headers: any = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      
      const verifyRes = await fetch("/api/tool/verify", {
        method: "POST",
        headers,
        body: JSON.stringify({ userId, toolId, role, token })
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.success) {
        throw new Error(verifyData.error || "User verification failed");
      }

      // 2. Analyze (Optional but kept for this project's logic)
      const analysisResult = await analyzeProduct(originalImage);
      const newAnalysis: AnalysisResultExtended = {
        title: analysisResult.title || "精美产品",
        sellingPoints: (analysisResult.sellingPoints || []).map((sp) => ({
          id: Math.random().toString(36).substr(2, 9),
          text: sp,
        })),
        footer: analysisResult.footer || "",
      };
      setAnalysis(newAnalysis);

      // 3. Generate Gemini Background
      const url = await generateEcomBackground(
        selectedStyle.prompt,
        "",
        "",
        selectedRatio as any,
        selectedResolution as any,
        originalImage,
        selectedPerspective.prompt,
      );

      // 4. Update UI immediately
      setGeneratedImages([url]);
      setSelectedImageIndex(0);

      // 5. Consume Points
      const consumeRes = await fetch("/api/tool/consume", {
        method: "POST",
        headers,
        body: JSON.stringify({ userId, toolId, role, token })
      });
      const consumeData = await consumeRes.json();
      if (consumeData.success && consumeData.data?.integral !== undefined) {
        setUserIntegral(consumeData.data.integral);
      }

      // 6. Persist to SaaS
      const persistRes = await persistResultImage(
        url,
        `${APP_SOURCE}_${Date.now()}.png`,
        userId,
        toolId,
        role,
        token,
        APP_SOURCE
      );

      if (persistRes.success) {
        const item = wrapHistoryItem(persistRes.image?.url || url, newAnalysis);
        saveToHistory(item);
      } else {
        console.warn("Failed to persist image to SaaS:", persistRes.error);
        // Still save to local history so user doesn't lose it in this session
        saveToHistory(wrapHistoryItem(url, newAnalysis));
      }

    } catch (imgError: any) {
      console.error(`Generation error:`, imgError);

      if (imgError.message === "GENERATION_TIMEOUT_BUT_MAY_HAVE_SAVED") {
        // Wait 4 seconds for SaaS to finish async processing potentially
        await new Promise((resolve) => setTimeout(resolve, 4000));

        // Refresh history from SaaS
        try {
          const { userId, role } = saasContext;
          const res = await fetch(
            `/api/upload/image?userId=${userId}&role=${role || 1}`,
          );
          const text = await res.text().catch(() => "");
          let result: any = null;
          try {
            result = text ? JSON.parse(text) : null;
          } catch {}
          
          if (result && result.success && result.data && result.data.length > 0) {
            const appImages = result.data.filter((img: any) => {
              const source = img.source || img.meta?.source || "";
              const fileName = img.fileName || img.objectKey || img.url || "";
              return source === APP_SOURCE || fileName.includes(APP_SOURCE);
            });

            if (appImages.length > 0) {
              const latestImg = appImages[0];
              const createdTime = new Date(latestImg.createdAt).getTime();
              const now = new Date().getTime();

              if (now - createdTime < 180000) { // 3 mins
                const url = latestImg.url;
                setGeneratedImages([url]);
                setSelectedImageIndex(0);
                console.log("Recovered 504 image from SaaS:", url);

                const mappedItem: GeneratedItem = {
                  id: latestImg.id,
                  originalImage: originalImage!,
                  generatedImage: latestImg.url,
                  title: "已恢复的历史海报",
                  sellingPoints: analysis.sellingPoints,
                  footer: analysis.footer,
                  style: selectedStyle.name,
                  ratio: selectedRatio,
                  resolution: selectedResolution,
                  timestamp: new Date(latestImg.createdAt).toLocaleTimeString(),
                };
                setHistory((prev) => [
                  mappedItem,
                  ...prev.filter((h) => h.id !== mappedItem.id),
                ]);
              }
            }
          }
        } catch (refreshErr) {
          console.error("Failed to recover image from history:", refreshErr);
        }
      } else {
        alert(imgError.message || "生成失败，请重试");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadImage = async () => {
    if (!resultContainerRef.current) return;
    try {
      // Clear cache and wait briefly
      await new Promise((resolve) => setTimeout(resolve, 200));
      const dataUrl = await htmlToImage.toPng(resultContainerRef.current, {
        cacheBust: true,
        pixelRatio:
          selectedResolution === "4K"
            ? 3
            : selectedResolution === "2K"
              ? 2
              : 1.5,
        quality: 1,
      });
      const link = document.createElement("a");
      const safeTitle = analysis.title
        .replace(/[^\u4e00-\u9fa5a-z0-9]/gi, "_")
        .substring(0, 30);
      link.download = `poster-${safeTitle || "design"}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Failed to export image", err);
      alert("导出图片失败，可能是图片未完全加载或网络问题，请稍后重试");
    }
  };

  const removeFromHistory = async (item: GeneratedItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!saasContext) return;

    try {
      const { userId, role } = saasContext;
      const res = await fetch("/api/upload/image", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, userId, role: role || 1 }),
      });
      const result = await res.json().catch(() => ({ success: false }));
      if (result.success) {
        setHistory((prev) => prev.filter((h) => h.id !== item.id));
      }
    } catch (err) {
      console.error("Failed to delete image:", err);
      // Even if server fails, remove from UI for better experience
      setHistory((prev) => prev.filter((h) => h.id !== item.id));
    }
  };

  const selectHistoryItem = (item: GeneratedItem) => {
    setOriginalImage(item.originalImage);
    setGeneratedImages([item.generatedImage]);
    setSelectedImageIndex(0);
    setAnalysis({
      title: item.title,
      sellingPoints: item.sellingPoints,
      footer: item.footer,
    });
    setSelectedRatio(item.ratio);
    setSelectedResolution(item.resolution);
    setActiveTab("result");
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#f8f9fa] text-slate-800 font-sans overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 flex justify-between items-center bg-white shadow-sm z-10 shrink-0 border-b border-slate-100">
        <div className="flex items-center gap-3 w-[250px]">
          <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white font-bold text-lg">
            精
          </div>
          <div>
            <h1 className="font-bold text-slate-800 text-base leading-tight">精华液电商图</h1>
            <p className="text-[10px] text-slate-500">智能生成工具</p>
          </div>
        </div>

        {/* Center Tabs */}
        <div className="flex bg-slate-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab("settings")}
            className={`px-6 py-1.5 text-sm font-semibold rounded-md transition-all ${
              activeTab === "settings"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            第一步：上传与参数设置
          </button>
          <button
            onClick={() => setActiveTab("result")}
            className={`px-6 py-1.5 text-sm font-semibold rounded-md transition-all ${
              activeTab === "result"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            第二步：生成结果与修改
          </button>
        </div>
        
        {/* User Info / Points */}
        <div className="w-[250px] flex justify-end">
          {saasContext && (
            <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-orange-50 text-sm font-medium text-orange-600 border border-orange-100">
              <Sparkles className="w-4 h-4" />
              <span>积分: <span className="font-bold">{userIntegral ?? saasContext.integral ?? 0}</span></span>
            </div>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <AnimatePresence mode="wait">
          {activeTab === "settings" ? (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="h-full max-w-[1400px] mx-auto flex flex-col lg:flex-row gap-8"
            >
              {/* STEP 1 - LEFT: Upload */}
              <div className="flex-1 shrink-0 flex justify-center mt-2 lg:mt-6">
                <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200 shadow-sm w-full max-w-[700px] aspect-[16/9] lg:aspect-auto lg:h-[480px] max-h-[500px] flex flex-col items-center">
                  <div className="w-full text-left mb-6 shrink-0">
                    <h3 className="font-bold text-lg text-slate-800">产品图片</h3>
                  </div>
                  <div className="relative w-full flex-1 rounded-3xl bg-white border-2 border-dashed border-slate-200 hover:border-slate-300 transition-all group overflow-hidden bg-clip-padding">
                    {originalImage ? (
                      <>
                        <img
                          src={originalImage}
                          className="w-full h-full object-contain p-4"
                          alt="Product"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all cursor-pointer">
                          <label className="cursor-pointer text-white flex flex-col items-center gap-2 h-full w-full justify-center">
                            <RefreshCw className="w-8 h-8" />
                            <span className="text-sm font-medium">重传图片</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={handleFileUpload}
                            />
                          </label>
                        </div>
                      </>
                    ) : (
                      <label className="h-full w-full flex flex-col items-center justify-center gap-4 cursor-pointer">
                        <div className="w-14 h-14 rounded-full bg-white shadow-sm flex items-center justify-center border border-slate-100">
                          <Upload className="w-7 h-7 text-slate-800" />
                        </div>
                        <div className="text-center px-4">
                          <p className="text-base font-bold text-slate-800">上传精华液实拍图</p>
                          <p className="text-xs text-slate-400 mt-1">推荐纯色背景环境</p>
                        </div>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleFileUpload}
                        />
                      </label>
                    )}
                  </div>
                </div>
              </div>

              {/* STEP 1 - RIGHT: Settings */}
              <div className="w-full lg:w-[420px] shrink-0 h-full overflow-y-auto pb-4">
                <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm flex flex-col min-h-max space-y-8">
                  {/* Style Settings */}
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#7B61FF]" />
                      <label className="text-sm font-bold text-slate-800">画面风格选择</label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {STYLES.map((style) => (
                        <button
                          key={style.id}
                          onClick={() => setSelectedStyle(style)}
                          className={`py-3 flex items-center justify-center rounded-xl text-sm font-bold border transition-all gap-2 ${selectedStyle.id === style.id ? "bg-slate-900 border-slate-900 text-white shadow-sm" : "bg-slate-50 border-transparent text-slate-600 hover:border-slate-200"}`}
                        >
                          <ImageIcon className={`w-4 h-4 ${selectedStyle.id === style.id ? 'opacity-100' : 'opacity-40'}`} />
                          {style.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Perspective Settings */}
                  <div className="space-y-4">
                    <label className="text-xs font-bold text-slate-400 block">
                      拍摄视角
                    </label>
                    <div className="flex gap-2">
                      {PERSPECTIVES.map((perspective) => (
                        <button
                          key={perspective.id}
                          onClick={() => setSelectedPerspective(perspective)}
                          className={`flex-1 py-3 rounded-xl text-xs font-bold border transition-all ${selectedPerspective.id === perspective.id ? "bg-slate-900 border-slate-900 text-white shadow-sm" : "bg-slate-50 border-transparent text-slate-500 hover:border-slate-200"}`}
                        >
                          {perspective.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Ratio & Resolution */}
                  <div className="flex flex-col gap-6">
                    <div className="space-y-4">
                      <label className="text-xs font-bold text-slate-400 block">
                        画幅比例
                      </label>
                      <div className="flex gap-2">
                        {RATIOS.map((ratio) => (
                          <button
                            key={ratio}
                            onClick={() => setSelectedRatio(ratio)}
                            className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all border ${selectedRatio === ratio ? "bg-slate-900 border-slate-900 text-white shadow-sm" : "bg-slate-50 border-transparent text-slate-500 hover:border-slate-200"}`}
                          >
                            {ratio}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-4">
                      <label className="text-xs font-bold text-slate-400 block">
                        输出分辨率
                      </label>
                      <div className="flex gap-2">
                        {RESOLUTIONS.map((res) => (
                          <button
                            key={res}
                            onClick={() => setSelectedResolution(res)}
                            className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all border ${selectedResolution === res ? "bg-slate-900 border-slate-900 text-white shadow-sm" : "bg-slate-50 border-transparent text-slate-500 hover:border-slate-200"}`}
                          >
                            {res}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 pt-4">
                    <button
                      onClick={handleGenerate}
                      disabled={!originalImage || isGenerating}
                      className={`w-full py-4 rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2 ${
                        originalImage && !isGenerating 
                          ? 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm' 
                          : 'bg-[#cfcfcf] text-white cursor-not-allowed'
                      }`}
                      style={{ backgroundColor: originalImage && !isGenerating ? undefined : '#b5b5b5' }}
                    >
                      <Sparkles className="w-5 h-5" /> 生成商品图
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="result"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="min-h-full flex flex-col gap-8 pb-12"
            >
              <div className="max-w-[1400px] mx-auto w-full flex flex-col lg:flex-row gap-8 items-start">
                {/* STEP 2 - LEFT: Preview */}
                <div className="flex-1 flex flex-col gap-6 min-w-0 w-full lg:sticky lg:top-4">
                  {/* Poster Preview Area */}
                  <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                    {isGenerating ? (
                      <div className="min-h-[500px] flex flex-col items-center justify-center gap-4 p-12">
                        <RefreshCw className="w-16 h-16 text-orange-500 animate-spin" />
                        <p className="text-lg text-slate-600 font-medium tracking-wide text-center">
                          AI 正在为您创作专属商品海报...
                        </p>
                        <p className="text-sm text-slate-400 text-center">
                          请耐心等待，预计需要 5-10 秒
                        </p>
                      </div>
                    ) : generatedImageUrl ? (
                      <div className="w-full flex flex-col items-center justify-center p-6 lg:p-8 bg-slate-50/50">
                        <div className="relative group max-w-full flex items-center justify-center">
                          <div
                            ref={resultContainerRef}
                            onClick={() => setIsPreviewOpen(true)}
                            className="relative overflow-hidden rounded-[2.5rem] shadow-2xl border border-slate-200 bg-white inline-block cursor-zoom-in transition-transform hover:scale-[1.01]"
                          >
                            <img
                              src={generatedImageUrl!}
                              className="max-h-[90vh] w-auto h-auto object-contain pointer-events-none block"
                              alt="Poster Result"
                              crossOrigin="anonymous"
                              referrerPolicy="no-referrer"
                            />
                            
                            <div className="absolute top-4 right-4 z-30 opacity-0 group-hover:opacity-100 transition-opacity">
                              <div className="bg-black/50 backdrop-blur-md p-2 rounded-full text-white">
                                <Maximize2 className="w-5 h-5" />
                              </div>
                            </div>

                            {/* DYNAMIC POSTER LAYOUT LOGIC - SURROUNDING SUBJECT */}
                            <div
                              className={`absolute inset-0 pointer-events-none z-20 py-[10%] px-[4%] flex flex-col items-center justify-between`}
                            >
                              {/* Title - Fixed Top Center */}
                              <div className="w-full text-center mb-4">
                                <span
                                  className={`block font-sans font-bold text-[36px] tracking-[0.15em] ${currentTextColor} leading-tight drop-shadow-xl whitespace-pre-line`}
                                >
                                  {analysis.title}
                                </span>
                              </div>

                              {/* Middle Area - Surrounding Selling Points */}
                              <div className="flex-1 w-full relative">
                                {analysis.sellingPoints.length === 1 && (
                                  <div
                                    className={`absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-3 ${currentTextColor} font-rounded font-semibold text-[20px] drop-shadow-sm`}
                                  >
                                    <div
                                      className={`w-2 h-2 rounded-full shrink-0 ${
                                        currentTextColor.includes("white")
                                          ? "bg-white"
                                          : "bg-slate-800"
                                      }`}
                                    />
                                    <span className="whitespace-pre-line">
                                      {analysis.sellingPoints[0].text}
                                    </span>
                                  </div>
                                )}

                                {analysis.sellingPoints.length === 2 && (
                                  <>
                                    <div
                                      className={`absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-3 ${currentTextColor} font-rounded font-semibold text-[20px] drop-shadow-sm text-right`}
                                    >
                                      <span className="whitespace-pre-line">
                                        {analysis.sellingPoints[0].text}
                                      </span>
                                      <div
                                        className={`w-2 h-2 rounded-full shrink-0 ${
                                          currentTextColor.includes("white")
                                            ? "bg-white"
                                            : "bg-slate-800"
                                        }`}
                                      />
                                    </div>
                                    <div
                                      className={`absolute -right-[10px] top-1/2 -translate-y-1/2 flex items-center gap-3 ${currentTextColor} font-rounded font-semibold text-[20px] drop-shadow-sm text-left`}
                                    >
                                      <div
                                        className={`w-2 h-2 rounded-full shrink-0 ${
                                          currentTextColor.includes("white")
                                            ? "bg-white"
                                            : "bg-slate-800"
                                      }`}
                                      />
                                      <span className="whitespace-pre-line">
                                        {analysis.sellingPoints[1].text}
                                      </span>
                                    </div>
                                  </>
                                )}

                                {analysis.sellingPoints.length >= 3 && (
                                  <>
                                    <div
                                      className={`absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-3 ${currentTextColor} font-rounded font-semibold text-[20px] drop-shadow-sm text-right`}
                                    >
                                      <span className="whitespace-pre-line">
                                        {analysis.sellingPoints[0].text}
                                      </span>
                                      <div
                                        className={`w-2 h-2 rounded-full shrink-0 ${
                                          currentTextColor.includes("white")
                                            ? "bg-white"
                                            : "bg-slate-800"
                                        }`}
                                      />
                                    </div>
                                    <div className="absolute -right-[10px] top-1/2 -translate-y-1/2 flex flex-col gap-24 lg:gap-40">
                                      <div
                                        className={`flex items-center gap-3 ${currentTextColor} font-rounded font-semibold text-[20px] drop-shadow-sm text-left`}
                                      >
                                        <div
                                          className={`w-2 h-2 rounded-full shrink-0 ${
                                            currentTextColor.includes("white")
                                              ? "bg-white"
                                              : "bg-slate-800"
                                          }`}
                                        />
                                        <span className="whitespace-pre-line">
                                          {analysis.sellingPoints[1].text}
                                        </span>
                                      </div>
                                      <div
                                        className={`flex items-center gap-3 ${currentTextColor} font-rounded font-semibold text-[20px] drop-shadow-sm text-left`}
                                      >
                                        <div
                                          className={`w-2 h-2 rounded-full shrink-0 ${
                                            currentTextColor.includes("white")
                                              ? "bg-white"
                                              : "bg-slate-800"
                                          }`}
                                        />
                                        <span className="whitespace-pre-line">
                                          {analysis.sellingPoints[2].text || ""}
                                        </span>
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>

                              {/* Footer - Fixed Bottom Center */}
                              {analysis.footer && (
                                <div className="w-full text-center mt-6">
                                  <span
                                    className={`block font-rounded font-light text-[18px] tracking-[0.2em] opacity-90 ${currentTextColor} drop-shadow-sm`}
                                  >
                                    {analysis.footer}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="aspect-[4/5] flex flex-col items-center justify-center gap-4 text-slate-400 p-12">
                        <ImageIcon className="w-16 h-16 opacity-10" />
                        <p className="text-lg text-center">请先在第一步上传并点击生成商品图</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* STEP 2 - RIGHT: Editing Controls */}
                <div className="w-full lg:w-[420px] shrink-0 h-full">
                  <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200 shadow-sm min-h-[600px] flex flex-col gap-6">
                    <div className="flex items-center gap-2 font-bold text-lg shrink-0">
                      <Sparkles className="w-5 h-5 text-orange-500" />
                      海报文案与排版
                    </div>
                    
                    <div className="flex-1 flex flex-col gap-6">
                      <div className="space-y-4 shrink-0">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            主标题内容
                          </label>
                          <textarea
                            rows={2}
                            value={analysis.title}
                            onChange={(e) =>
                              setAnalysis({
                                ...analysis,
                                title: e.target.value,
                              })
                            }
                            className="w-full px-4 py-3 rounded-xl border border-slate-100 font-bold text-lg outline-none resize-none focus:ring-2 focus:ring-orange-100 transition-all bg-slate-50"
                          />
                        </div>
                        <div className="space-y-3">
                          <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            <span>
                              核心卖点 (最多3条){" "}
                              {analysis.sellingPoints.length}/3
                            </span>
                            <button
                              onClick={addSellingPoint}
                              className={`text-orange-500 px-3 py-1 rounded-md bg-orange-50 hover:bg-orange-100 transition-colors ${
                                analysis.sellingPoints.length >= 3
                                  ? "opacity-30 cursor-not-allowed"
                                  : ""
                              }`}
                              disabled={analysis.sellingPoints.length >= 3}
                            >
                              添加
                            </button>
                          </div>
                          <div className="space-y-2">
                            {analysis.sellingPoints.map((sp) => (
                              <div key={sp.id} className="flex gap-2">
                                <textarea
                                  rows={2}
                                  value={sp.text}
                                  onChange={(e) =>
                                    updateSellingPointText(
                                      sp.id,
                                      e.target.value
                                    )
                                  }
                                  className="flex-1 px-4 py-2 rounded-xl border border-slate-50 bg-slate-50 text-sm outline-none resize-none focus:ring-2 focus:ring-orange-100 transition-all"
                                />
                                <button
                                  onClick={() => removeSellingPoint(sp.id)}
                                  className="text-slate-300 hover:text-red-500 pt-2 transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            底部补充信息
                          </label>
                          <input
                            type="text"
                            value={analysis.footer || ""}
                            onChange={(e) =>
                              setAnalysis({
                                ...analysis,
                                footer: e.target.value,
                              })
                            }
                            className="w-full px-4 py-3 rounded-xl border border-slate-100 bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-orange-100 transition-all"
                          />
                        </div>
                      </div>

                      <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 shrink-0 mt-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-3">
                          文字配色
                        </label>
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                          {TEXT_COLORS.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => setSelectedTextColor(c.id)}
                              className={`px-2 py-2.5 text-[11px] font-medium rounded-lg border transition-all ${
                                selectedTextColor === c.id
                                  ? "bg-orange-50 text-orange-600 border-orange-500 shadow-sm"
                                  : "bg-white text-slate-500 border-slate-100 hover:border-orange-200 hover:bg-orange-50"
                              }`}
                            >
                              {c.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="mt-auto pt-4 shrink-0">
                        <button
                          onClick={downloadImage}
                          disabled={!generatedImageUrl || isGenerating}
                          className={`w-full py-4 rounded-2xl font-bold text-lg transition-all flex items-center justify-center gap-3 ${
                            !generatedImageUrl || isGenerating
                              ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                              : "bg-orange-500 text-white hover:bg-orange-600 shadow-[0_4px_14px_0_rgba(249,115,22,0.39)]"
                          }`}
                        >
                          <Download className="w-5 h-5" /> 下载高清海报
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* STEP 2 - BOTTOM: History Row */}
              <div className="max-w-[1400px] mx-auto w-full">
                <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm flex flex-col shrink-0">
                  <div className="flex items-center justify-between w-full mb-6">
                    <div className="flex items-center gap-2">
                      <History className="w-5 h-5 text-slate-400" />
                      <h3 className="font-bold text-slate-800 text-lg">
                        历史记录回顾
                      </h3>
                    </div>
                    <span className="text-xs text-slate-400 font-medium">共 {history.length} 条记录</span>
                  </div>
                  <div className="flex overflow-x-auto gap-4 custom-scrollbar pb-4 -mx-2 px-2">
                    {history.length === 0 ? (
                      <div className="text-center py-12 w-full bg-slate-50/50 rounded-2xl border border-dashed border-slate-100">
                        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
                          <History className="w-6 h-6 text-slate-300" />
                        </div>
                        <p className="text-sm text-slate-400 font-medium">
                          暂无历史生成记录
                        </p>
                      </div>
                    ) : (
                      history.map((item) => (
                        <div
                          key={item.id}
                          onClick={() => selectHistoryItem(item)}
                          className={`group relative w-[280px] shrink-0 cursor-pointer rounded-2xl border p-4 flex gap-4 transition-all items-center hover:shadow-md ${
                            generatedImageUrl === item.generatedImage
                              ? "border-orange-500 bg-orange-50 ring-1 ring-orange-200 shadow-sm"
                              : "border-slate-100 bg-white hover:border-orange-200"
                          }`}
                        >
                          <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-slate-100 shrink-0 border border-slate-100">
                            <img
                              src={item.generatedImage}
                              className="w-full h-full object-cover"
                              alt="history"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate mb-1">
                              {item.title || "生成的作品"}
                            </p>
                            <div className="flex items-center gap-2 mt-2">
                              <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-bold uppercase">
                                {item.ratio}
                              </span>
                              <span className="text-[10px] text-slate-400 font-medium">
                                {item.timestamp}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={(e) => removeFromHistory(item, e)}
                            className="absolute -top-2 -right-2 p-1.5 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-white hover:bg-red-500 bg-white shadow-md rounded-full transition-all border border-slate-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Full Screen Preview Modal */}
      <AnimatePresence>
        {isPreviewOpen && generatedImageUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsPreviewOpen(false)}
            className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 lg:p-12 cursor-zoom-out"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-full max-h-full flex items-center justify-center p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={generatedImageUrl}
                className="max-w-full max-h-[85vh] object-contain shadow-2xl rounded-lg lg:rounded-2xl"
                alt="Full Preview"
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
              />
              
              <div className="absolute -top-8 right-0 lg:-right-12 text-white/60 hover:text-white cursor-pointer transition-colors" onClick={() => setIsPreviewOpen(false)}>
                <Check className="w-8 h-8 rotate-45" /> {/* Close button hack since no Close icon imported except Refresh */}
              </div>

              <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-4">
                 <button 
                  onClick={downloadImage}
                  className="px-8 py-3 bg-white text-slate-900 rounded-full font-bold shadow-xl hover:scale-105 transition-transform flex items-center gap-2"
                >
                  <Download className="w-5 h-5" /> 下载高清原图
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
    </div>
  );
}
