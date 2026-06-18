/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useMemo, ReactNode, CSSProperties } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  ChevronRight, 
  ChevronLeft, 
  Download,
  Settings,
  Type,
  Maximize2,
  Minimize2,
  Copy,
  Trash2,
  FileText,
  Image as ImageIcon,
  Check,
  Highlighter,
  Eraser,
  Bold
} from "lucide-react";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { saveAs } from "file-saver";

interface StoryChunk {
  id: string;
  content: string;
}

interface Highlight {
  id: string;
  text: string;
  color: string;
  pageIndex: number;
}

function getInlineFontFamily(fontClass: string): string {
  switch (fontClass) {
    case "font-inter":
      return '"Inter", "Helvetica Neue", Arial, sans-serif';
    case "font-roboto":
      return '"Roboto", "Helvetica Neue", Arial, sans-serif';
    case "font-lato":
      return '"Lato", "Helvetica Neue", Arial, sans-serif';
    case "font-poppins":
      return '"Poppins", sans-serif';
    case "font-serif":
      return 'Georgia, Cambria, "Times New Roman", Times, serif';
    case "font-playfair":
      return '"Playfair Display", Georgia, serif';
    case "font-lora":
      return '"Lora", Georgia, serif';
    case "font-bebas":
      return '"Bebas Neue", Impact, sans-serif';
    case "font-mono":
      return '"JetBrains Mono", Courier New, monospace';
    default:
      return 'serif';
  }
}

function getHighlightStyles(colorClass: string, isBold: boolean): { 
  style: CSSProperties; 
  className: string; 
  isText: boolean; 
} {
  const isCustomBg = colorClass.startsWith("bg-custom:");
  const isCustomText = colorClass.startsWith("text-custom:");
  const isStandardText = colorClass.includes("text-") || colorClass.includes("bg-transparent");
  const isText = isCustomBg ? false : (isCustomText || isStandardText);

  // Default font weight ensures no automatic bold styling is applied. It is strictly normal weight (400) unless bold is toggled.
  const style: CSSProperties = {
    fontWeight: isBold ? 700 : 400
  };

  if (isText) {
    if (isCustomText) {
      style.color = colorClass.replace("text-custom:", "");
    } else {
      const match = colorClass.match(/text-\[([^\]]+)\]/);
      if (match) {
        style.color = match[1];
      }
    }
    style.backgroundColor = "transparent";
    return {
      style,
      className: isCustomText ? "" : colorClass,
      isText: true
    };
  } else {
    style.WebkitPrintColorAdjust = "exact";
    style.printColorAdjust = "exact";
    
    if (isCustomBg) {
      style.backgroundColor = colorClass.replace("bg-custom:", "");
    } else {
      const match = colorClass.match(/bg-\[([^\]]+)\]/);
      if (match) {
        style.backgroundColor = match[1];
      }
    }
    return {
      style,
      className: isCustomBg 
        ? "text-gray-900 rounded px-1.5 text-center select-text transition-colors py-0.5 mx-0.5 shadow-2xs inline-block" 
        : `${colorClass} text-gray-900 rounded px-1.5 text-center select-text transition-colors py-0.5 mx-0.5 shadow-2xs inline-block`,
      isText: false
    };
  }
}

function renderHighlightedText(text: string, pageHighlights: Array<{ text: string, color: string }>, isBold: boolean) {
  if (!pageHighlights || pageHighlights.length === 0) return text;

  // Sort highlights to match longer strings first to avoid substring/nested highlight bugs
  const sortedHighlights = [...pageHighlights].sort((a, b) => b.text.length - a.text.length);

  interface Interval {
    start: number;
    end: number;
    color: string;
  }
  const intervals: Interval[] = [];

  for (const hl of sortedHighlights) {
    if (!hl.text) continue;
    
    // Escape string for RegExp matches safely
    const escaped = hl.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + hl.text.length;
      
      // Check if this interval overlaps with any existing interval we've already matched
      const overlaps = intervals.some(
        inv => (start >= inv.start && start < inv.end) || 
               (end > inv.start && end <= inv.end) || 
               (inv.start >= start && inv.start < end)
      );
      
      if (!overlaps) {
        intervals.push({ start, end, color: hl.color });
      }
    }
  }

  if (intervals.length === 0) return text;

  // Sort remaining valid intervals in text order
  intervals.sort((a, b) => a.start - b.start);

  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (let i = 0; i < intervals.length; i++) {
    const inv = intervals[i];
    if (inv.start > lastIndex) {
      parts.push(text.substring(lastIndex, inv.start));
    }
    
    const { style, className, isText } = getHighlightStyles(inv.color, isBold);

    if (isText) {
      parts.push(
        <span 
          key={`hl-${i}-${inv.start}`} 
          className={className}
          style={style}
        >
          {text.substring(inv.start, inv.end)}
        </span>
      );
    } else {
      parts.push(
        <mark 
          key={`hl-${i}-${inv.start}`} 
          className={className}
          style={style}
        >
          {text.substring(inv.start, inv.end)}
        </mark>
      );
    }
    lastIndex = inv.end;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts;
}

export default function App() {
  const [storyInput, setStoryInput] = useState("");
  const [commentsInput, setCommentsInput] = useState("");
  const [chunkSize, setChunkSize] = useState(1);
  const [selectedFont, setSelectedFont] = useState(() => {
    try {
      const saved = localStorage.getItem("reddit_story_selectedFont_v2");
      return saved || "font-serif";
    } catch {
      return "font-serif";
    }
  });
  const [isBold, setIsBold] = useState(() => {
    try {
      const saved = localStorage.getItem("reddit_story_isBold_v2");
      return saved === "true";
    } catch {
      return false;
    }
  });
  const [fontSize, setFontSize] = useState(() => {
    try {
      const saved = localStorage.getItem("reddit_story_fontSize_v2");
      return saved ? parseInt(saved, 10) : 24;
    } catch {
      return 24;
    }
  });
  const [currentPage, setCurrentPage] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0 });
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<"live" | "images">("live");
  const [copied, setCopied] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem("reddit_story_fontSize_v2", fontSize.toString());
    } catch (e) {
      console.error(e);
    }
  }, [fontSize]);

  useEffect(() => {
    try {
      localStorage.setItem("reddit_story_selectedFont_v2", selectedFont);
    } catch (e) {
      console.error(e);
    }
  }, [selectedFont]);

  useEffect(() => {
    try {
      localStorage.setItem("reddit_story_isBold_v2", isBold.toString());
    } catch (e) {
      console.error(e);
    }
  }, [isBold]);

  const [highlights, setHighlights] = useState<Highlight[]>(() => {
    try {
      const saved = localStorage.getItem("reddit_story_highlights_v1");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [activeSelection, setActiveSelection] = useState<{
    text: string;
    pageIndex: number;
    rect: { top: number; left: number; width: number } | null;
  } | null>(null);

  const [customColor, setCustomColor] = useState("#ff4500");
  const [customColorType, setCustomColorType] = useState<"bg" | "text">("bg");

  const [pageBoldOverrides, setPageBoldOverrides] = useState<Record<number, boolean>>(() => {
    try {
      const saved = localStorage.getItem("reddit_story_page_bold_v2");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("reddit_story_page_bold_v2", JSON.stringify(pageBoldOverrides));
    } catch (e) {
      console.error(e);
    }
  }, [pageBoldOverrides]);

  useEffect(() => {
    try {
      localStorage.setItem("reddit_story_highlights_v1", JSON.stringify(highlights));
    } catch (e) {
      console.error(e);
    }
  }, [highlights]);

  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setActiveSelection(null);
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) {
      setActiveSelection(null);
      return;
    }

    // Determine if selection is within a preview page
    let node: Node | null = selection.anchorNode;
    let pageIndex: number | null = null;

    while (node && node !== document.body) {
      if (node instanceof HTMLElement && node.hasAttribute("data-page-index")) {
        pageIndex = parseInt(node.getAttribute("data-page-index") || "0", 10);
        break;
      }
      node = node.parentNode;
    }

    if (pageIndex !== null) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const container = document.getElementById("preview-scroll-container");
      
      if (container) {
        const containerRect = container.getBoundingClientRect();
        // Calculate position relative to container
        const top = rect.top - containerRect.top + container.scrollTop;
        const left = rect.left - containerRect.left + container.scrollLeft;
        
        setActiveSelection({
          text: selectedText,
          pageIndex,
          rect: {
            top,
            left,
            width: rect.width
          }
        });
      }
    } else {
      setActiveSelection(null);
    }
  };

  const addHighlight = (colorClass: string) => {
    if (!activeSelection) return;
    const { text, pageIndex } = activeSelection;

    const newHighlight: Highlight = {
      id: `hl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      text,
      color: colorClass,
      pageIndex
    };

    setHighlights((prev) => {
      // Find if an identical highlight exists on this page
      const exists = prev.some(h => h.pageIndex === pageIndex && h.text.toLowerCase() === text.toLowerCase());
      if (exists) {
        return prev.map(h => (h.pageIndex === pageIndex && h.text.toLowerCase() === text.toLowerCase()) ? { ...h, color: colorClass } : h);
      }
      return [...prev, newHighlight];
    });

    window.getSelection()?.removeAllRanges();
    setActiveSelection(null);
  };

  const removeHighlightForSelection = () => {
    if (!activeSelection) return;
    const { text, pageIndex } = activeSelection;

    setHighlights((prev) => {
      // Remove any highlights on this page that overlap or match the selected text
      return prev.filter(h => !(h.pageIndex === pageIndex && (
        h.text.toLowerCase().includes(text.toLowerCase()) || 
        text.toLowerCase().includes(h.text.toLowerCase())
      )));
    });

    window.getSelection()?.removeAllRanges();
    setActiveSelection(null);
  };

  // Split story and comments into chunks
  const chunks = useMemo(() => {
    const now = Date.now();
    setGeneratedImages([]); // Reset images when chunks change
    setActiveView("live");
    
    // Process story: split by sentence boundaries AND line breaks
    const processStory = (text: string) => {
      if (!text.trim()) return [];
      const segments = text.split(/\n+|(?<=[\.!\?])\s+/).filter(s => s.trim().length > 0);
      const result: StoryChunk[] = [];
      for (let i = 0; i < segments.length; i += chunkSize) {
        result.push({
          id: `story-chunk-${i}-${now}`, 
          content: segments.slice(i, i + chunkSize).join(" ").trim()
        });
      }
      return result;
    };

    // Process comments: ONLY split by manual line breaks
    const processComments = (text: string) => {
      if (!text.trim()) return [];
      // Split ONLY by newlines
      const segments = text.split(/\n+/).filter(s => s.trim().length > 0);
      const result: StoryChunk[] = [];
      for (let i = 0; i < segments.length; i++) {
        result.push({
          id: `comment-chunk-${i}-${now}`, 
          content: segments[i].trim()
        });
      }
      return result;
    };

    const storyChunks = processStory(storyInput);
    const commentChunks = processComments(commentsInput);

    return [...storyChunks, ...commentChunks];
  }, [storyInput, commentsInput, chunkSize]);

  // Ensure current page is within bounds
  useEffect(() => {
    if (currentPage >= chunks.length && chunks.length > 0) {
      setCurrentPage(chunks.length - 1);
    }
  }, [chunks.length]);

  const generateImages = async () => {
    if (chunks.length === 0) return;
    setIsGenerating(true);
    setGenerationProgress({ current: 0, total: chunks.length });
    setGeneratedImages([]);

    try {
      console.log("Starting optimized parallel image generation...");
      // Step 1: Wait for any pending renders and browser fonts to be ready
      await document.fonts.ready;
      await new Promise(r => setTimeout(r, 100)); // Minimal prep delay for stable rendering layout

      // Process elements asynchronously and concurrently to maximize performance
      const capturePromises = chunks.map(async (_, i) => {
        const element = document.getElementById(`preview-page-${i}`);
        if (!element) {
          console.warn(`Element preview-page-${i} not found`);
          setGenerationProgress(prev => ({ ...prev, current: prev.current + 1 }));
          return { dataUrl: "", index: i };
        }

        try {
          // Use html-to-image toPng with same-origin font styles
          const dataUrl = await toPng(element, {
            quality: 1.0,
            pixelRatio: 2,
            backgroundColor: "#f9f9f9",
            style: {
              transform: "none",
              margin: "0",
              opacity: "1",
              display: "block"
            },
            skipFonts: false,
            styleSheetsFilter: (styleSheet: any) => {
              try {
                if (!styleSheet.href) {
                  return false; // Safely ignore style tags / inline stylesheets which might contain oklch()
                }
                const url = styleSheet.href;
                // ONLY allow our clean localized font definitions to be loaded!
                // This completely prevents any oklch() parsing crash from other CSS files!
                return url.includes("fonts.css");
              } catch (e) {
                return false;
              }
            }
          } as any);

          // Update real-time progress counter
          setGenerationProgress(prev => ({ ...prev, current: prev.current + 1 }));
          return { dataUrl, index: i };
        } catch (pageError) {
          console.error(`Page ${i} capture failed:`, pageError);
          setGenerationProgress(prev => ({ ...prev, current: prev.current + 1 }));
          return { dataUrl: "", index: i };
        }
      });

      // Wait for all rendering tasks to complete in parallel
      const results = await Promise.all(capturePromises);
      
      // Sort to preserve original pagination/ordering sequence
      const sortedImages = results
        .sort((a, b) => a.index - b.index)
        .map(r => r.dataUrl)
        .filter(url => url && url.length > 100);
      
      if (sortedImages.length > 0) {
        setGeneratedImages(sortedImages);
        setActiveView("images");
      }
    } catch (error) {
      console.error("Overall generation failed:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadZIP = async () => {
    if (generatedImages.length === 0) return;
    setIsExporting(true);
    const zip = new JSZip();

    try {
      generatedImages.forEach((dataUrl, i) => {
        const base64Data = dataUrl.split(",")[1];
        zip.file(`story-page-${i + 1}.png`, base64Data, { base64: true });
      });

      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, "reddit-story-pages.zip");
    } catch (error) {
      console.error("Export failed:", error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(storyInput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-white text-[#1a1a1b] font-sans overflow-hidden">
      {/* Left Side: Input & Controls */}
      <aside className="w-full md:w-1/2 flex flex-col border-r border-gray-200 bg-white">
        <header className="p-4 border-b border-gray-100 flex items-center justify-between bg-white z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-600 rounded-full flex items-center justify-center text-white font-bold">
              R
            </div>
            <h1 className="font-bold text-lg tracking-tight">Reddit Story Maker</h1>
          </div>
          <div className="flex gap-2">
             <button 
                onClick={handleCopy}
                className="p-2 hover:bg-gray-100 rounded-md transition-colors text-gray-500"
                title="Copy Text"
             >
               {copied ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
             </button>
             <button 
                onClick={() => setStoryInput("")}
                className="p-2 hover:bg-gray-100 rounded-md transition-colors text-gray-500"
                title="Clear Text"
             >
               <Trash2 size={18} />
             </button>
          </div>
        </header>

        <section className="flex-1 p-6 overflow-y-auto space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Story Input</label>
            <textarea
              className="w-full h-80 p-4 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none resize-none leading-relaxed text-gray-700 placeholder:text-gray-300"
              placeholder="Paste your full Reddit story here..."
              value={storyInput}
              onChange={(e) => setStoryInput(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className={`text-xs font-bold uppercase tracking-wider ${storyInput.trim() ? "text-gray-400" : "text-gray-200"}`}>Reddit Comments</label>
            <textarea
              className="w-full h-40 p-4 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none resize-none leading-relaxed text-gray-700 placeholder:text-gray-300 disabled:bg-gray-50 disabled:border-gray-100 disabled:cursor-not-allowed"
              placeholder={storyInput.trim() ? "Paste comments here (will be added after the story)..." : "Enter a story first to enable comments..."}
              value={commentsInput}
              onChange={(e) => setCommentsInput(e.target.value)}
              disabled={!storyInput.trim()}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Sentences per Page</label>
                <div className="flex items-center gap-4 bg-gray-50 p-2 rounded-lg border border-gray-100">
                  <input 
                    type="range" 
                    min="1" 
                    max="10" 
                    value={chunkSize} 
                    onChange={(e) => setChunkSize(parseInt(e.target.value))}
                    className="flex-1 accent-orange-600"
                  />
                  <span className="font-mono font-bold w-6 text-center">{chunkSize}</span>
                </div>
             </div>
             <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Select Font Style</label>
                <select 
                  value={selectedFont} 
                  onChange={(e) => setSelectedFont(e.target.value)}
                  className="w-full bg-gray-50 p-2 rounded-lg border border-gray-100 text-sm font-medium outline-none focus:ring-2 focus:ring-orange-500 cursor-pointer"
                >
                  <option value="font-inter">Modern Sans (Inter)</option>
                  <option value="font-roboto">Clean Sans (Roboto)</option>
                  <option value="font-lato">Friendly Sans (Lato)</option>
                  <option value="font-poppins">Geometric Sans (Poppins)</option>
                  <option value="font-serif">Classic Serif</option>
                  <option value="font-playfair">Elegant Playfair</option>
                  <option value="font-lora">Refined Lora</option>
                  <option value="font-bebas">Bold Display</option>
                  <option value="font-mono">Technical Mono</option>
                </select>
             </div>
          </div>

          <div className="space-y-2 border-t border-gray-100 pt-4">
             <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                   Customize Sizing & Weight
                </label>
                <div className="flex items-center gap-2">
                   <button
                     type="button"
                     onClick={() => setIsBold((prev) => !prev)}
                     className={`px-3 py-1 text-xs font-bold rounded-lg border flex items-center gap-1.5 cursor-pointer transition-all ${
                       isBold 
                       ? "bg-orange-600 text-white border-orange-600 hover:bg-orange-700 shadow-xs" 
                       : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                     }`}
                     title="Toggle Bold Text"
                   >
                     <Bold size={12} className={isBold ? "stroke-[3px]" : "stroke-[2.5px]"} />
                     <span>Bold</span>
                   </button>
                   <span className="text-xs font-mono font-extrabold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full border border-orange-100">{fontSize}px</span>
                </div>
             </div>
             <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-lg border border-gray-100">
                <button
                  type="button"
                  onClick={() => setFontSize(prev => Math.max(14, prev - 1))}
                  className="w-8 h-8 flex items-center justify-center bg-white hover:bg-gray-100 border border-gray-200 rounded-lg text-xs font-bold text-gray-600 cursor-pointer transition-all active:scale-90 hover:border-gray-300 shadow-2xs select-none"
                  title="Decrease Font Size"
                >
                  A-
                </button>
                <input 
                  type="range" 
                  min="14" 
                  max="48" 
                  value={fontSize} 
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="flex-1 accent-orange-600 cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => setFontSize(prev => Math.min(48, prev + 1))}
                  className="w-8 h-8 flex items-center justify-center bg-white hover:bg-gray-100 border border-gray-200 rounded-lg text-xs font-bold text-gray-600 cursor-pointer transition-all active:scale-90 hover:border-gray-300 shadow-2xs select-none"
                  title="Increase Font Size"
                >
                  A+
                </button>
             </div>
          </div>

          {/* Highlights Manager */}
          <div className="space-y-2 border-t border-gray-100 pt-5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                <Highlighter size={13} className="text-orange-500" /> Story Highlights
              </label>
              {highlights.length > 0 && (
                <button
                  onClick={() => setHighlights([])}
                  className="text-[10px] uppercase tracking-wider font-bold text-red-500 hover:text-red-700 transition-colors cursor-pointer"
                >
                  Clear All
                </button>
              )}
            </div>
            
            {highlights.length === 0 ? (
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-center text-xs text-gray-400 leading-relaxed font-normal">
                Highlight key details: select any words directly on the preview pages to highlight them!
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-2 max-h-48 overflow-y-auto space-y-1">
                {highlights.map((hl) => {
                  const hlIndicatorBg = hl.color.includes("text-[#e17b35]")
                    ? "bg-[#e17b35]"
                    : hl.color.includes("text-amber-500")
                    ? "bg-amber-400"
                    : hl.color.includes("text-emerald-500")
                    ? "bg-emerald-500"
                    : hl.color;

                  return (
                    <div 
                      key={hl.id} 
                      className="flex items-center justify-between text-xs bg-white border border-gray-100/80 p-2 rounded-lg shadow-2xs group/hl"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${hlIndicatorBg} border border-black/10`} />
                        <span className="text-[10px] font-bold text-gray-400 font-mono flex-shrink-0">Page {hl.pageIndex + 1}</span>
                        <span className="truncate font-medium text-gray-700 italic">"{hl.text}"</span>
                      </div>
                      <button
                        onClick={() => setHighlights((prev) => prev.filter(h => h.id !== hl.id))}
                        className="text-gray-400 hover:text-red-500 p-1 rounded transition-colors cursor-pointer flex-shrink-0"
                        title="Delete highlight"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-4">
               <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 text-center">
                  <div className="text-xs text-gray-400 uppercase">Pages</div>
                  <div className="font-bold">{chunks.length}</div>
               </div>
               <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 text-center">
                  <div className="text-xs text-gray-400 uppercase">Chars</div>
                  <div className="font-bold">{storyInput.length + commentsInput.length}</div>
               </div>
            </div>
          </div>

          <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100/50">
             <h4 className="text-sm font-bold text-orange-800 mb-2 flex items-center gap-2">
               <Settings size={14} /> Pro Tip
             </h4>
             <p className="text-xs text-orange-700/80 leading-relaxed">
               Each downloaded PNG will exactly match the size and style of the blocks you see in the preview column.
             </p>
          </div>
        </section>

        <footer className="p-4 border-t border-gray-100 bg-gray-50 flex flex-col gap-3">
           <button
              onClick={generateImages}
              disabled={isGenerating || chunks.length === 0}
              className="w-full flex items-center justify-center gap-2 bg-[#1a1a1b] text-white py-3 rounded-xl font-bold hover:bg-black transition-all disabled:opacity-30 group"
           >
             {isGenerating ? (
               <>
                 <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                 <span>Capturing Page {generationProgress.current} of {generationProgress.total}...</span>
               </>
             ) : (
               <>
                 <ImageIcon size={18} className="group-hover:scale-110 transition-transform" />
                 <span>Generate Images</span>
               </>
             )}
           </button>

           <button
              onClick={downloadZIP}
              disabled={isExporting || generatedImages.length === 0}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all border ${
                generatedImages.length > 0 
                ? "bg-orange-600 text-white border-orange-600 hover:bg-orange-700 shadow-sm" 
                : "bg-white text-gray-300 border-gray-100 cursor-not-allowed"
              }`}
           >
             {isExporting ? (
               <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span>Preparing ZIP...</span>
               </>
             ) : (
               <>
                 <Download size={18} />
                 <span>Download ZIP ({generatedImages.length})</span>
               </>
             )}
           </button>
        </footer>
      </aside>

      {/* Right Side: Live Preview */}
      <main className="flex-1 bg-white flex flex-col relative overflow-hidden">
        <div className="absolute top-0 w-full p-4 flex justify-between items-center z-10 bg-white border-b border-gray-100">
           <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em]">
                {activeView === "images" ? "Captured Images" : "Live Preview"}
              </span>
              {generatedImages.length > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-bold bg-green-50 text-green-600 px-2 py-0.5 rounded-full border border-green-100 animate-pulse animate-duration-1000">
                  <Check size={10} /> Ready to Download
                </span>
              )}
           </div>
           <div className="flex items-center gap-3">
              {generatedImages.length > 0 && (
                <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-200/60 shadow-2xs">
                  <button
                    onClick={() => setActiveView("live")}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer select-none ${
                      activeView === "live"
                        ? "bg-white text-orange-600 shadow-xs border border-gray-200/50"
                        : "text-gray-500 hover:text-gray-800"
                    }`}
                  >
                    Live Screen
                  </button>
                  <button
                    onClick={() => setActiveView("images")}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer select-none ${
                      activeView === "images"
                        ? "bg-white text-orange-600 shadow-xs border border-gray-200/50"
                        : "text-gray-500 hover:text-gray-800"
                    }`}
                    title="View the generated PNG screenshots"
                  >
                    Captured PNGs ({generatedImages.length})
                  </button>
                </div>
              )}
              {generatedImages.length > 0 && (
                <button 
                  onClick={() => {
                    setGeneratedImages([]);
                    setActiveView("live");
                  }}
                  className="text-xs font-bold text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                  title="Clear generated images and return to editing"
                >
                  Clear Results
                </button>
              )}
              <span className="text-sm font-mono font-bold text-gray-400 bg-gray-50 px-3 py-1 rounded-full border border-gray-100">
                {chunks.length} Total Pages
              </span>
           </div>
        </div>

        <div 
          id="preview-scroll-container"
          className="flex-1 p-8 md:p-12 overflow-y-auto pt-20 relative select-text"
          onMouseUp={handleTextSelection}
          onKeyUp={handleTextSelection}
        >
          <AnimatePresence mode="wait">
            {activeView === "images" && generatedImages.length > 0 ? (
              <motion.div 
                key="gallery"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="max-w-xl mx-auto space-y-8 pb-20"
              >
                {generatedImages.map((img, idx) => (
                  <motion.div 
                    key={`captured-${idx}`}
                    initial={{ scale: 0.98, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: idx * 0.05 }}
                    className="group relative"
                  >
                    <div className="absolute -left-12 top-0 text-[10px] font-mono text-gray-300 transform -rotate-90 origin-right">
                      PAGE_{idx + 1}
                    </div>
                    <img 
                      src={img} 
                      alt={`Page ${idx + 1}`} 
                      className="w-full"
                      referrerPolicy="no-referrer"
                    />
                  </motion.div>
                ))}
              </motion.div>
            ) : chunks.length > 0 ? (
              <motion.div 
                key="preview"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="max-w-xl mx-auto space-y-10 pb-20 select-text"
              >
                {chunks.map((chunk, index) => {
                  const isPageBold = pageBoldOverrides[index] !== undefined 
                    ? pageBoldOverrides[index] 
                    : isBold;

                  return (
                    <div key={chunk.id} className="space-y-2.5 border border-gray-100/80 rounded-2xl p-4 bg-gray-50/50">
                      {/* Page-Specific Action Toolbar (Outside screen capture element so it won't be in export pictures) */}
                      <div className="flex items-center justify-between px-1 select-none">
                        <span className="text-[10px] font-mono font-bold text-gray-500 bg-white border border-gray-200/60 rounded-md px-2 py-0.5 shadow-2xs">
                          Page {index + 1}
                        </span>
                        
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setPageBoldOverrides(prev => ({
                                ...prev,
                                [index]: !isPageBold
                              }));
                            }}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                              isPageBold
                                ? "bg-orange-600 text-white border-orange-600 hover:bg-orange-700 shadow-3xs"
                                : "bg-white text-gray-500 border-gray-200 hover:text-gray-700 hover:bg-gray-100"
                            }`}
                            title="Format this page in bold"
                          >
                            <Bold size={10} className={isPageBold ? "stroke-[3px]" : "stroke-[2.5px]"} />
                            <span>{isPageBold ? "Page Bold: ON" : "Page Bold: OFF"}</span>
                          </button>
                          
                          {pageBoldOverrides[index] !== undefined && (
                            <button
                              type="button"
                              onClick={() => {
                                setPageBoldOverrides(prev => {
                                  const updated = { ...prev };
                                  delete updated[index];
                                  return updated;
                                });
                              }}
                              className="text-[9px] text-gray-400 hover:text-red-500 underline transition-colors cursor-pointer"
                              title="Reset page bold settings to match default global toggle weight"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Actual Captured Page Card */}
                      <motion.div
                        id={`preview-page-${index}`}
                        data-page-index={index}
                        className="w-full p-8 md:p-10 bg-[#f9f9f9] border border-gray-100 select-text cursor-text relative shadow-xs"
                        style={{
                          backgroundColor: "#f9f9f9",
                          padding: "2.5rem",
                          border: "1px solid #f3f4f6",
                          borderRadius: "0.5rem",
                          boxSizing: "border-box",
                          width: "100%",
                          display: "block"
                        }}
                      >
                        <p 
                          className={`text-gray-900 leading-[1.6] text-left ${selectedFont} ${isPageBold ? "font-bold" : "font-normal"} select-text`}
                          style={{ 
                            fontSize: `${fontSize}px`,
                            fontFamily: getInlineFontFamily(selectedFont),
                            fontWeight: isPageBold ? 700 : 400,
                            lineHeight: "1.6",
                            textAlign: "left",
                            color: "#111827",
                            width: "100%",
                            margin: 0
                          }}
                        >
                          {renderHighlightedText(chunk.content, highlights.filter(h => h.pageIndex === index), isPageBold)}
                        </p>
                      </motion.div>
                    </div>
                  );
                })}
              </motion.div>
            ) : (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full flex flex-col items-center justify-center text-center space-y-4"
              >
                 <div className="w-20 h-20 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-300">
                    <FileText size={40} />
                 </div>
                 <p className="text-gray-400 font-medium">Your preview will appear here...</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Floating Highlight Toolbar */}
          <AnimatePresence>
            {activeSelection && activeSelection.rect && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="absolute z-50 bg-[#141416]/95 text-white rounded-2xl shadow-2xl p-4 flex flex-col gap-3.5 border border-gray-800/80 backdrop-blur-md w-[320px]"
                style={{
                  top: `${Math.max(10, activeSelection.rect.top - 230)}px`,
                  left: `${activeSelection.rect.left + activeSelection.rect.width / 2}px`,
                  transform: "translateX(-50%)",
                }}
              >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-800 pb-1.5 mb-0.5">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider select-none">
                    Format Selection
                  </span>
                  <button 
                    onClick={removeHighlightForSelection}
                    className="text-[10px] uppercase tracking-wider font-bold text-red-400 hover:text-red-300 transition-colors flex items-center gap-1 cursor-pointer"
                    title="Clear current selection highlights"
                  >
                    <Eraser size={10} />
                    <span>Clear</span>
                  </button>
                </div>

                {/* Section 1: Predefined Backgrounds */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest text-left select-none">
                    Background Color Highlight
                  </span>
                  <div className="grid grid-cols-8 gap-1.5 justify-items-center">
                    {[
                      { label: "Yellow", class: "bg-[#fef08a]" },
                      { label: "Pink", class: "bg-[#fbcfe8]" },
                      { label: "Green", class: "bg-[#bbf7d0]" },
                      { label: "Blue", class: "bg-[#bfdbfe]" },
                      { label: "Purple", class: "bg-[#e9d5ff]" },
                      { label: "Orange", class: "bg-[#fed7aa]" },
                      { label: "Red", class: "bg-[#fecaca]" },
                      { label: "Slate", class: "bg-[#e2e8f0]" },
                    ].map((color) => (
                      <button
                        key={color.label}
                        title={color.label}
                        onClick={() => addHighlight(color.class)}
                        className={`w-6 h-6 rounded-full ${color.class} hover:scale-125 transition-all border border-white/10 shadow-xs cursor-pointer focus:outline-none flex items-center justify-center`}
                      />
                    ))}
                  </div>
                </div>

                {/* Section 2: Predefined Text Styles */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest text-left select-none">
                    Text Colors (Shorts Style)
                  </span>
                  <div className="flex gap-2.5 justify-start">
                    {[
                      { label: "Shorts Orange", class: "text-[#e17b35] bg-transparent" },
                      { label: "Shorts Yellow", class: "text-[#fbbf24] bg-transparent" },
                      { label: "Shorts Green", class: "text-[#34d399] bg-transparent" },
                      { label: "Shorts Blue", class: "text-[#60a5fa] bg-transparent" },
                      { label: "Shorts Pink", class: "text-[#f472b6] bg-transparent" },
                    ].map((color) => (
                      <button
                        key={color.label}
                        title={color.label}
                        onClick={() => addHighlight(color.class)}
                        className="w-6 h-6 rounded-full bg-gray-900 border border-gray-800 hover:scale-125 transition-all cursor-pointer flex items-center justify-center focus:outline-none"
                      >
                        <span 
                          className="text-[10px] font-black select-none leading-none" 
                          style={{ color: color.class.match(/text-\[([^\]]+)\]/)?.[1] || "#f97316" }}
                        >
                          T
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Section 3: Custom Color Tool */}
                <div className="flex flex-col gap-1.5 border-t border-gray-800 pt-2">
                  <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest text-left select-none">
                    Custom Color Picker
                  </span>
                  <div className="flex items-center gap-2">
                    {/* Compact Interactive Color Element */}
                    <div className="relative group">
                      <input 
                        type="color" 
                        value={customColor}
                        onChange={(e) => setCustomColor(e.target.value)}
                        className="w-8 h-8 rounded-lg border border-gray-700 bg-transparent cursor-pointer p-0 select-none focus:outline-none focus:ring-1 focus:ring-orange-500"
                        title="Pick custom hue"
                      />
                    </div>

                    {/* Segment Control for Text vs Bg */}
                    <div className="flex-1 bg-gray-900 border border-gray-800 rounded-lg p-0.5 flex">
                      <button
                        type="button"
                        onClick={() => setCustomColorType("bg")}
                        className={`flex-1 text-[10px] font-bold py-1 px-1.5 rounded transition-all select-none cursor-pointer ${
                          customColorType === "bg" 
                            ? "bg-gray-800 text-white shadow-xs" 
                            : "text-gray-400 hover:text-white"
                        }`}
                      >
                        BG Highlight
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomColorType("text")}
                        className={`flex-1 text-[10px] font-bold py-1 px-1.5 rounded transition-all select-none cursor-pointer ${
                          customColorType === "text" 
                            ? "bg-gray-800 text-white shadow-xs" 
                            : "text-gray-400 hover:text-white"
                        }`}
                      >
                        Text Color
                      </button>
                    </div>

                    {/* Action Button */}
                    <button
                      onClick={() => {
                        if (customColorType === "bg") {
                          addHighlight(`bg-custom:${customColor}`);
                        } else {
                          addHighlight(`text-custom:${customColor}`);
                        }
                      }}
                      className="px-2.5 py-1.5 text-[10px] font-bold bg-orange-600 hover:bg-orange-500 active:scale-95 text-white rounded-lg cursor-pointer transition-all flex items-center gap-1 shadow-xs"
                      title="Apply pick"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

