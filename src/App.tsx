/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
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
  Monitor
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzeProduct, generateEcomBackground, AnalysisResult } from './lib/gemini.ts';
import * as htmlToImage from 'html-to-image';

interface SellingPoint {
  id: string;
  text: string;
}

interface AnalysisResultExtended {
  title: string;
  sellingPoints: SellingPoint[];
  footer?: string;
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

const STYLES = [
  { 
    id: 'high-tech', 
    name: '高端科技', 
    prompt: 'Replica of premium scientific aesthetic: A futuristic precision robotic metal arm or technical tweezers centrally holding the product. The background consists of elegant flowing golden liquid ribbons and waves with integrated digital glowing particle grids and luminous micro-points. Use soft golden cinematic lighting. IDENTIFY THE PRODUCT IN THE ATTACHED IMAGE AND REPLACE THE SUBJECT IN THIS SCENE WITH IT. Keep the robotic arm and golden wave environment exactly as described while seamlessly integrating the product.' 
  },
  { 
    id: 'luxury', 
    name: '轻奢黄金', 
    prompt: 'Premium luxury gold aesthetic: The background features sparkling, shimmering golden sand and fine glitter. A smooth, glossy wave of molten liquid gold flows gracefully at one edge. Several elegant metallic golden leaves with distinct veins are scattered around. The scene is illuminated with dramatic, magical lighting including bright glowing sparkles, subtle lens flares, and soft bokeh. IDENTIFY THE UPLOADED PRODUCT AND INTEGRATE IT INTO THIS SHIMMERING GOLDEN ENVIRONMENT as the main subject. Ensure realistic lighting, shadows, and reflections. Do not alter the original product design.' 
  },
];

const TEXT_COLORS = [
  { id: '', name: '自动' },
  { id: 'text-slate-800 drop-shadow-sm', name: '简约黑' },
  { id: 'text-white drop-shadow-md', name: '纯净白' },
  { id: 'text-[#facc15] drop-shadow-md', name: '日光黄' },
  { id: 'bg-gradient-to-b from-yellow-100 via-yellow-400 to-yellow-600 bg-clip-text text-transparent drop-shadow-[0_3px_6px_rgba(0,0,0,0.4)]', name: '黄金渐变' },
  { id: 'bg-gradient-to-b from-slate-100 via-slate-300 to-slate-500 bg-clip-text text-transparent drop-shadow-[0_2px_5px_rgba(0,0,0,0.3)]', name: '白银渐变' },
  { id: 'bg-gradient-to-r from-rose-200 via-rose-400 to-rose-600 bg-clip-text text-transparent drop-shadow-[0_2px_5px_rgba(0,0,0,0.3)]', name: '玫瑰渐变' },
];

const RATIOS = ['1:1', '3:4', '4:3', '16:9'];
const RESOLUTIONS = ['1K', '2K', '4K'];

export default function App() {
  // State
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResultExtended>({ title: '', sellingPoints: [] });
  const [generationStep, setGenerationStep] = useState(0);
  const [selectedStyle, setSelectedStyle] = useState(STYLES[0]);
  const [selectedRatio, setSelectedRatio] = useState('1:1');
  const [selectedResolution, setSelectedResolution] = useState('1K');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [history, setHistory] = useState<GeneratedItem[]>([]);
  const [activeTab, setActiveTab] = useState<'settings' | 'result'>('settings');
  const [isDarkBg, setIsDarkBg] = useState(false);
  const [selectedTextColor, setSelectedTextColor] = useState<string>('');
  
  // SaaS Context state
  const [saasContext, setSaasContext] = useState<any>(null);

  useEffect(() => {
    // 1. Handle postMessage initialization
    const handleSaasMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SAAS_INIT') {
        const context = event.data;
        setSaasContext(context);
        (window as any).SAAS_CONTEXT = context;
        console.log('SaaS Initialized via message:', context);
        
        // Optionally launch tool on SaaS side
        fetch('/api/tool/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: context.userId, toolId: context.toolId })
        }).catch(err => console.error('Launch error:', err));
      }
    };

    window.addEventListener('message', handleSaasMessage);

    // 2. Fallback to URL params
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId');
    const toolId = params.get('toolId');
    if (userId && toolId && !saasContext) {
      const context = { userId, toolId };
      setSaasContext(context);
      (window as any).SAAS_CONTEXT = context;
      console.log('SaaS Context from URL:', context);
    }

    return () => window.removeEventListener('message', handleSaasMessage);
  }, [saasContext]);

  const currentTextColor = selectedTextColor ? selectedTextColor : (isDarkBg ? 'text-white' : 'text-slate-800');
  const generatedImageUrl = generatedImages[selectedImageIndex] || null;

  const resultContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (generatedImageUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = 100;
        c.height = 100;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, 100, 100);
          const data = ctx.getImageData(0, 0, 100, 100).data;
          let brightness = 0;
          for (let i = 0; i < data.length; i += 4) {
            brightness += (data[i] + data[i+1] + data[i+2]) / 3;
          }
          brightness = brightness / (100 * 100);
          setIsDarkBg(brightness < 128);
        }
      };
      img.src = generatedImageUrl;
    }
  }, [generatedImageUrl]);

  // Handlers
  const fetchHistory = async () => {
    if (!saasContext) return;
    try {
      const { userId, role } = saasContext;
      const res = await fetch(`/api/upload/image?userId=${userId}&role=${role || 1}`);
      const result = await res.json();
      if (result.success && result.data) {
        // Map SaaS image data to match GeneratedItem interface
        const mappedHistory: GeneratedItem[] = result.data.map((img: any) => ({
          id: img.id,
          originalImage: '', // original image is not stored in SaaS as per princple 0
          generatedImage: img.url,
          title: img.fileName.split('/').pop()?.split('_').pop() || 'AI海报',
          sellingPoints: [],
          style: '',
          ratio: '1:1',
          resolution: '1K',
          timestamp: new Date(img.createdAt).toLocaleTimeString(),
        }));
        setHistory(mappedHistory);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [saasContext]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setOriginalImage(event.target?.result as string);
        setGeneratedImages([]);
        setAnalysis({ title: '', sellingPoints: [] });
        setActiveTab('settings');
      };
      reader.readAsDataURL(file);
    }
  };

  const saveToHistory = (item: GeneratedItem) => {
    setHistory(prev => [item, ...prev].slice(0, 30));
  };

  const wrapHistoryItem = (image: string, itemAnalysis: AnalysisResultExtended) => {
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

  const addSellingPoint = () => {
    const newPoint: SellingPoint = {
      id: Math.random().toString(36).substr(2, 9),
      text: '新核心卖点'
    };
    setAnalysis(prev => ({
      ...prev,
      sellingPoints: [...prev.sellingPoints, newPoint]
    }));
  };

  const removeSellingPoint = (id: string) => {
    setAnalysis(prev => ({
      ...prev,
      sellingPoints: prev.sellingPoints.filter(p => p.id !== id)
    }));
  };

  const updateSellingPointText = (id: string, text: string) => {
    setAnalysis(prev => ({
      ...prev,
      sellingPoints: prev.sellingPoints.map(p => p.id === id ? { ...p, text } : p)
    }));
  };

  const handleGenerate = async () => {
    if (!originalImage) return;
    setIsGenerating(true);
    setActiveTab('result');
    setGeneratedImages([]);
    setSelectedImageIndex(0);

    try {
      const analysisResult = await analyzeProduct(originalImage);
      const newAnalysis: AnalysisResultExtended = {
        title: analysisResult.title || '精美产品',
        sellingPoints: (analysisResult.sellingPoints || []).map(sp => ({
          id: Math.random().toString(36).substr(2, 9),
          text: sp
        })),
        footer: analysisResult.footer || '',
      };
      setAnalysis(newAnalysis);

      // Generate images sequentially
      const perspectives = [
        "The product stands upright, shot from a top-left diagonal 45-degree high angle perspective. Ensure it integrates perfectly with the background environment.",
        "The product is tilted at a 45-degree angle, frontal eye-level cinematic shot. Ensure realistic lighting and contact shadows.",
        "A bird's-eye view flat-lay shot, the product is centered and lying completely flat on the surface of the environment."
      ];

      for (let i = 0; i < perspectives.length; i++) {
        setGenerationStep(i + 1);
          try {
            const url = await generateEcomBackground(
              selectedStyle.prompt,
              '',
              '',
              selectedRatio as any,
              selectedResolution as any,
              originalImage,
              perspectives[i]
            );
            
            const itemAnalysis = { ...newAnalysis };
            setAnalysis(itemAnalysis);
            setGeneratedImages(prev => [...prev, url]);
            setSelectedImageIndex(i); // Update to show latest image
            saveToHistory(wrapHistoryItem(url, itemAnalysis));
          } catch (imgError) {
          console.error(`Perspective ${i + 1} generation failed:`, imgError);
        }
      }

      if (generatedImages.length === 0 && !isGenerating) {
        // This means ALL failed if we get here and it was empty
      }

    } catch (error) {
      console.error('Core generation logic failed:', error);
      alert('生成过程出现异常，请检查网络或图片大小后重试');
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadImage = async () => {
    if (!resultContainerRef.current) return;
    try {
      // Clear cache and wait briefly
      await new Promise(resolve => setTimeout(resolve, 200));
      const dataUrl = await htmlToImage.toPng(resultContainerRef.current, {
        cacheBust: true,
        pixelRatio: selectedResolution === '4K' ? 3 : (selectedResolution === '2K' ? 2 : 1.5),
        quality: 1,
      });
      const link = document.createElement('a');
      const safeTitle = analysis.title.replace(/[^\u4e00-\u9fa5a-z0-9]/gi, '_').substring(0, 30);
      link.download = `poster-${safeTitle || 'design'}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Failed to export image', err);
      alert('导出图片失败，可能是图片未完全加载或网络问题，请稍后重试');
    }
  };

  const removeFromHistory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!saasContext) return;
    try {
      const { userId, role } = saasContext;
      const res = await fetch('/api/upload/image', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, userId, role: role || 1 })
      });
      const result = await res.json();
      if (result.success) {
        setHistory(prev => prev.filter(item => item.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete image:', err);
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
    setActiveTab('result');
  };

  return (
    <div className="flex h-screen w-full bg-[#f8f9fa] text-slate-800 font-sans overflow-hidden">
      <div className="w-[350px] border-r border-slate-200 bg-white flex flex-col">
        <div className="p-6 border-b border-slate-100 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-500">1</div>
            <h3 className="font-semibold text-slate-700">产品上传与分析</h3>
          </div>
          <div className="relative aspect-square w-full rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 hover:border-orange-300 hover:bg-orange-50 transition-all group">
            {originalImage ? (
              <>
                <img src={originalImage} className="w-full h-full object-contain p-4" alt="Product" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all rounded-2xl cursor-pointer">
                  <label className="cursor-pointer text-white flex flex-col items-center gap-2">
                    <RefreshCw className="w-8 h-8" />
                    <span className="text-sm font-medium">重传图片</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                  </label>
                </div>
              </>
            ) : (
              <label className="h-full w-full flex flex-col items-center justify-center gap-3 cursor-pointer">
                <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center">
                  <Upload className="w-6 h-6 text-orange-500" />
                </div>
                <div className="text-center px-4">
                  <p className="text-sm font-medium">点击上传产品图</p>
                  <p className="text-xs text-slate-400 mt-1">支持 JPG, PNG, WEBP</p>
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
              </label>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-50 flex items-center gap-2">
            <History className="w-5 h-5 text-slate-400" />
            <h2 className="font-semibold text-slate-600">历史记录</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {history.length === 0 ? (
              <div className="text-center py-10 opacity-40">
                <History className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                <p className="text-sm text-slate-400">暂无历史记录</p>
              </div>
            ) : (
              history.map((item) => (
                <div
                  key={item.id}
                  onClick={() => selectHistoryItem(item)}
                  className={`group relative cursor-pointer rounded-xl border p-2 transition-all ${
                    generatedImages.length === 1 && generatedImages[0] === item.generatedImage
                      ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-200' 
                      : 'border-slate-100 bg-slate-50 hover:border-orange-200 hover:bg-orange-50'
                  }`}
                >
                  <div className="flex gap-3">
                    <img src={item.generatedImage} className="w-16 h-16 rounded-lg object-cover bg-white" alt="history" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.title}</p>
                      <p className="text-[10px] text-slate-300 mt-1 uppercase">{item.resolution} | {item.ratio}</p>
                    </div>
                  </div>
                  <button 
                    onClick={(e) => removeFromHistory(item.id, e)}
                    className="absolute top-2 right-2 p-1.5 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 bg-white shadow-sm rounded-full transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        <div className="px-6 pt-4 flex gap-8 border-b border-slate-100">
          <button onClick={() => setActiveTab('settings')} className={`pb-3 text-sm font-semibold relative ${activeTab === 'settings' ? 'text-slate-900 border-b-2 border-orange-500' : 'text-slate-400'}`}>第2步 | 参数设置</button>
          <button onClick={() => setActiveTab('result')} className={`pb-3 text-sm font-semibold relative ${activeTab === 'result' ? 'text-slate-900 border-b-2 border-orange-500' : 'text-slate-400'}`}>第3步 | 生成结果</button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 bg-[#fafbfc] custom-scrollbar">
          <AnimatePresence mode="wait">
            {activeTab === 'settings' ? (
              <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-4xl mx-auto space-y-8">
                <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm space-y-3">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">整体视觉风格</label>
                  <div className="flex flex-wrap gap-3">
                    {STYLES.map((style) => (
                      <button key={style.id} onClick={() => setSelectedStyle(style)} className={`px-6 py-2.5 rounded-full text-sm border-2 ${selectedStyle.id === style.id ? 'bg-orange-500 border-orange-500 text-white shadow-md' : 'bg-white border-slate-100 text-slate-600'}`}>{style.name}</button>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    <div className="space-y-4">
                      <label className="text-xs font-semibold text-slate-500 block">画布比例</label>
                      <div className="flex gap-2">
                        {RATIOS.map(ratio => (
                          <button key={ratio} onClick={() => setSelectedRatio(ratio)} className={`flex-1 py-3 rounded-xl border-2 font-bold ${selectedRatio === ratio ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500'}`}>{ratio}</button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-4">
                      <label className="text-xs font-semibold text-slate-500 block">输出分辨率</label>
                      <div className="flex gap-2">
                        {RESOLUTIONS.map(res => (
                          <button key={res} onClick={() => setSelectedResolution(res)} className={`flex-1 py-3 rounded-xl border-2 font-bold ${selectedResolution === res ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500'}`}>{res}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <button onClick={handleGenerate} className="w-full py-5 rounded-2xl font-bold bg-slate-800 text-white hover:bg-slate-900 shadow-lg flex items-center justify-center gap-3"><Sparkles className="w-6 h-6" />立即开始生成主图</button>
                </div>
              </motion.div>
            ) : (
              <motion.div key="result" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className="min-h-full flex flex-col items-center pb-10">
                <div className="max-w-6xl w-full">
                  {isGenerating ? (
                    <div className="max-w-2xl mx-auto aspect-square w-full rounded-3xl bg-slate-100 flex flex-col items-center justify-center gap-4">
                      <RefreshCw className="w-12 h-12 text-orange-500 animate-spin" />
                      <p className="text-slate-500 font-medium tracking-wide">AI 正在并发创作三种视角构图中 ({generationStep}/3)...</p>
                      <p className="text-xs text-slate-400">请耐心等待，每个视角约需 5-10 秒</p>
                    </div>
                  ) : generatedImages.length > 0 ? (
                    <div className="flex flex-col lg:flex-row gap-8 w-full items-start">
                      {/* Left Side: Poster Preview */}
                      <div className="flex-1 w-full lg:sticky lg:top-4">
                        <div className="relative group">
                          <div ref={resultContainerRef} className="relative overflow-hidden rounded-[2.5rem] shadow-2xl border border-white/20 bg-white">
                            <img 
                              src={generatedImageUrl!} 
                              className="w-full h-auto pointer-events-none" 
                              alt="Poster Result" 
                              crossOrigin="anonymous"
                              referrerPolicy="no-referrer"
                            />
                            
                            {/* DYNAMIC POSTER LAYOUT LOGIC - SURROUNDING SUBJECT */}
                            <div className={`absolute inset-0 pointer-events-none z-20 py-[10%] px-[4%] flex flex-col items-center justify-between`}>
                              {/* Title - Fixed Top Center */}
                              <div className="w-full text-center mb-4">
                                <span className={`block font-sans font-bold text-[36px] tracking-[0.15em] ${currentTextColor} leading-tight drop-shadow-xl whitespace-pre-line`}>
                                  {analysis.title}
                                </span>
                              </div>

                              {/* Middle Area - Surrounding Selling Points */}
                              <div className="flex-1 w-full relative">
                                {analysis.sellingPoints.length === 1 && (
                                  <div className={`absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-3 ${currentTextColor} font-rounded font-semibold text-[20px] drop-shadow-sm`}>
                                    <div className={`w-2 h-2 rounded-full shrink-0 ${currentTextColor.includes('white') ? 'bg-white' : 'bg-slate-800'}`} />
                                    <span className="whitespace-pre-line">{analysis.sellingPoints[0].text}</span>
                                  </div>
                                )}

                                {analysis.sellingPoints.length === 2 && (
                                  <>
                                    <div className={`absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-3 ${currentTextColor} font-rounded font-semibold text-[20px] drop-shadow-sm text-right`}>
                                      <span className="whitespace-pre-line">{analysis.sellingPoints[0].text}</span>
                                      <div className={`w-2 h-2 rounded-full shrink-0 ${currentTextColor.includes('white') ? 'bg-white' : 'bg-slate-800'}`} />
                                    </div>
                                    <div className={`absolute -right-[10px] top-1/2 -translate-y-1/2 flex items-center gap-3 ${currentTextColor} font-rounded font-semibold text-[20px] drop-shadow-sm text-left`}>
                                      <div className={`w-2 h-2 rounded-full shrink-0 ${currentTextColor.includes('white') ? 'bg-white' : 'bg-slate-800'}`} />
                                      <span className="whitespace-pre-line">{analysis.sellingPoints[1].text}</span>
                                    </div>
                                  </>
                                )}

                                {analysis.sellingPoints.length >= 3 && (
                                  <>
                                    <div className={`absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-3 ${currentTextColor} font-rounded font-semibold text-[20px] drop-shadow-sm text-right`}>
                                      <span className="whitespace-pre-line">{analysis.sellingPoints[0].text}</span>
                                      <div className={`w-2 h-2 rounded-full shrink-0 ${currentTextColor.includes('white') ? 'bg-white' : 'bg-slate-800'}`} />
                                    </div>
                                    <div className="absolute -right-[10px] top-1/2 -translate-y-1/2 flex flex-col gap-48">
                                      <div className={`flex items-center gap-3 ${currentTextColor} font-rounded font-semibold text-[20px] drop-shadow-sm text-left`}>
                                        <div className={`w-2 h-2 rounded-full shrink-0 ${currentTextColor.includes('white') ? 'bg-white' : 'bg-slate-800'}`} />
                                        <span className="whitespace-pre-line">{analysis.sellingPoints[1].text}</span>
                                      </div>
                                      <div className={`flex items-center gap-3 ${currentTextColor} font-rounded font-semibold text-[20px] drop-shadow-sm text-left`}>
                                        <div className={`w-2 h-2 rounded-full shrink-0 ${currentTextColor.includes('white') ? 'bg-white' : 'bg-slate-800'}`} />
                                        <span className="whitespace-pre-line">{analysis.sellingPoints[2].text || ''}</span>
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>

                              {/* Footer - Fixed Bottom Center */}
                              {analysis.footer && (
                                <div className="w-full text-center mt-6">
                                  <span className={`block font-rounded font-light text-[18px] tracking-[0.2em] opacity-90 ${currentTextColor} drop-shadow-sm`}>
                                    {analysis.footer}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="absolute top-6 right-6 z-30 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                             <button onClick={downloadImage} className="p-4 bg-white/90 hover:bg-white text-slate-800 rounded-full shadow-xl" title="下载海报"><Download className="w-6 h-6" /></button>
                          </div>
                        </div>
                      </div>

                      {/* Right Side: Editing Controls */}
                      <div className="w-full lg:w-[400px] flex flex-col gap-6">
                        <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm space-y-6">
                          <div className="flex items-center gap-2 font-bold text-lg"><Sparkles className="w-5 h-5 text-orange-500" />海报文案修改</div>
                          <div className="space-y-4">
                             <div className="space-y-2">
                               <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">主标题内容</label>
                               <textarea rows={2} value={analysis.title} onChange={(e) => setAnalysis({ ...analysis, title: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-100 font-bold text-lg outline-none resize-none" />
                             </div>
                             <div className="space-y-3">
                               <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                <span>核心卖点 (最多3条) {analysis.sellingPoints.length}/3</span>
                                <button 
                                  onClick={addSellingPoint} 
                                  className={`text-orange-500 px-2 py-0.5 rounded hover:bg-orange-50 transition-colors ${analysis.sellingPoints.length >= 3 ? 'opacity-30 cursor-not-allowed' : ''}`}
                                  disabled={analysis.sellingPoints.length >= 3}
                                >
                                  添加
                                </button>
                              </div>
                               <div className="space-y-2">
                                 {analysis.sellingPoints.map((sp) => (
                                   <div key={sp.id} className="flex gap-2">
                                     <textarea rows={2} value={sp.text} onChange={(e) => updateSellingPointText(sp.id, e.target.value)} className="flex-1 px-4 py-2 rounded-xl border border-slate-50 text-sm outline-none resize-none" />
                                     <button onClick={() => removeSellingPoint(sp.id)} className="text-slate-300 hover:text-red-500 pt-2"><Trash2 className="w-4 h-4" /></button>
                                   </div>
                                 ))}
                               </div>
                             </div>
                             <div className="space-y-2">
                               <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">底部补充信息</label>
                               <input type="text" value={analysis.footer || ''} onChange={(e) => setAnalysis({ ...analysis, footer: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-100 text-sm outline-none" />
                             </div>
                          </div>
                        </div>

                        <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm flex flex-col gap-4">
                           <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">文字配色</label>
                           <div className="grid grid-cols-2 gap-2">
                             {TEXT_COLORS.map(c => (
                               <button key={c.id} onClick={() => setSelectedTextColor(c.id)} className={`px-2 py-2.5 text-[10px] rounded-lg border transition-all ${selectedTextColor === c.id ? 'bg-orange-500 text-white border-orange-500 shadow-sm' : 'bg-white text-slate-500 border-slate-100 hover:border-orange-200'}`}>{c.name}</button>
                             ))}
                           </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="max-w-2xl mx-auto aspect-square w-full rounded-3xl bg-slate-50 border-2 border-dashed flex flex-col items-center justify-center gap-3 text-slate-400">
                      <ImageIcon className="w-16 h-16 opacity-10" />
                      <p>请上传并点击生成</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
      `}</style>
    </div>
  );
}
