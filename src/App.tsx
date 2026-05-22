/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useMemo } from "react";
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
  Check
} from "lucide-react";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { saveAs } from "file-saver";

interface StoryChunk {
  id: string;
  content: string;
}

export default function App() {
  const [storyInput, setStoryInput] = useState("");
  const [commentsInput, setCommentsInput] = useState("");
  const [chunkSize, setChunkSize] = useState(1);
  const [selectedFont, setSelectedFont] = useState("font-serif");
  const [currentPage, setCurrentPage] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  // Split story and comments into chunks
  const chunks = useMemo(() => {
    const now = Date.now();
    setGeneratedImages([]); // Reset images when chunks change
    
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
    setGeneratedImages([]);
    const images: string[] = [];

    try {
      console.log("Starting image generation...");
      // Step 1: Wait for any pending renders and fonts
      await document.fonts.ready;
      await new Promise(r => setTimeout(r, 500));

      for (let i = 0; i < chunks.length; i++) {
        const element = document.getElementById(`preview-page-${i}`);
        if (!element) {
          console.warn(`Element preview-page-${i} not found`);
          continue;
        }

        // Scroll into view to ensure it's "real"
        element.scrollIntoView({ block: "center" });
        await new Promise(r => setTimeout(r, 200));

        try {
          console.log(`Capturing page ${i+1}...`);
          // Use html-to-image toPng
          const dataUrl = await toPng(element, {
            quality: 1,
            pixelRatio: 2,
            backgroundColor: "#f9f9f9",
            style: {
              transform: "none",
              margin: "0",
              opacity: "1",
              display: "block"
            },
            // skipFonts: true is a key suspect to fix the window.fetch override error
            skipFonts: true,
          });
          
          if (dataUrl && dataUrl.length > 100) {
            images.push(dataUrl);
            console.log(`Page ${i+1} captured successfully`);
          } else {
            console.warn(`Page ${i+1} capture produced empty image`);
          }
        } catch (pageError) {
          console.error(`Page ${i} capture failed:`, pageError);
        }
      }
      
      if (images.length > 0) {
        setGeneratedImages(images);
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
                  className="w-full bg-gray-50 p-2 rounded-lg border border-gray-100 text-sm font-medium outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="font-inter">Modern Sans</option>
                  <option value="font-serif">Classic Serif</option>
                  <option value="font-playfair">Elegant Playfair</option>
                  <option value="font-lora">Refined Lora</option>
                  <option value="font-bebas">Bold Display</option>
                  <option value="font-mono">Technical Mono</option>
                </select>
             </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Quick Stats</label>
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
                 <span>Capturing {chunks.length} Pages...</span>
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
                {generatedImages.length > 0 ? "Final Image Results" : "Live Preview"}
              </span>
              {generatedImages.length > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-bold bg-green-50 text-green-600 px-2 py-0.5 rounded-full border border-green-100">
                  <Check size={10} /> Captured
                </span>
              )}
           </div>
           <div className="flex items-center gap-3">
              {generatedImages.length > 0 && (
                <button 
                  onClick={() => setGeneratedImages([])}
                  className="text-xs font-bold text-orange-600 hover:text-orange-700 transition-colors"
                >
                  Edit Blocks
                </button>
              )}
              <span className="text-sm font-mono font-bold text-gray-400 bg-gray-50 px-3 py-1 rounded-full border border-gray-100">
                {chunks.length} Total Pages
              </span>
           </div>
        </div>

        <div className="flex-1 p-8 md:p-12 overflow-y-auto pt-20">
          <AnimatePresence mode="wait">
            {generatedImages.length > 0 ? (
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
                className="max-w-xl mx-auto space-y-6 pb-20"
              >
                {chunks.map((chunk, index) => (
                  <motion.div
                    key={chunk.id}
                    id={`preview-page-${index}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={`w-full p-8 md:p-10 bg-[#f9f9f9] border border-gray-100`}
                  >
                    <p className={`text-xl md:text-2xl text-gray-900 leading-[1.6] text-left ${selectedFont}`}>
                      {chunk.content}
                    </p>
                  </motion.div>
                ))}
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
        </div>
      </main>
    </div>
  );
}

