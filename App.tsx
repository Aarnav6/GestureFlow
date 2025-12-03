
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { HandData, AppMode, SceneObject, GestureType, AIGeneratedCommand, TransformMode } from './types';
import { INITIAL_OBJECTS } from './constants';
import HandTracker from './components/HandTracker';
import Scene3D from './components/Scene3D';
import { interpretCommand, askProjectQuestion } from './services/geminiService';
import { Move, Eye, Plus, Trash2, Palette, Square, Circle, Triangle, Disc, HelpCircle, X, Maximize2, RotateCw, Settings, MousePointer2, Gauge, Info, MessageSquare, Code, Cpu, Layers, Hand, BookOpen, Download, Image as ImageIcon, Box, HelpCircle as HelpIcon, Upload, FileJson } from 'lucide-react';

export default function App() {
  const [handData, setHandData] = useState<HandData | null>(null);
  const [objects, setObjects] = useState<SceneObject[]>(INITIAL_OBJECTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<AppMode>(AppMode.VIEW);
  const [transformMode, setTransformMode] = useState<TransformMode>('translate');
  const [sensitivity, setSensitivity] = useState(1.5); // Default sensitivity
  
  // Creation Flow States
  const [pendingObjectType, setPendingObjectType] = useState<'box'|'sphere'|'torus'|'cone'|null>(null);
  
  // Gesture Hold States
  const [holdStart, setHoldStart] = useState<{type: GestureType, time: number} | null>(null);
  const [activeProgress, setActiveProgress] = useState<{label: string, value: number} | null>(null);

  // Radial Menu State
  const [activeRadialSector, setActiveRadialSector] = useState<'move' | 'rotate' | 'scale' | 'color' | 'delete' | null>(null);

  // Help Center (Combined Help & AI)
  const [hubTab, setHubTab] = useState<'guide' | 'ai'>('guide');
  const [hubPinchCooldown, setHubPinchCooldown] = useState(false);

  // AI Chat States
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'ai', text: string}[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Settings & Export State
  // ROCK (Control Panel) and SHAKA (Cancel) are excluded from this list so they cannot be disabled
  const [gestureSettings, setGestureSettings] = useState<Record<string, boolean>>({
    [GestureType.POINTING]: true,
    [GestureType.PINCH]: true,
    [GestureType.VICTORY]: true, // Create
    [GestureType.THUMBS_UP]: true,
    [GestureType.THUMB_DOWN]: true,
    [GestureType.THREE_FINGERS]: true
  });
  const [exportRequest, setExportRequest] = useState<'image' | 'gltf' | null>(null);
  
  // File Import Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Constants
  const HOLD_DURATION = 1000; // ms

  // Hand tracking callback
  const handleHandUpdate = useCallback((data: HandData | null) => {
    // Check if gesture is enabled in settings before passing it on
    // System gestures (SHAKA, ROCK) always bypass this check
    if (data && data.gesture !== GestureType.NONE && data.gesture !== GestureType.SHAKA && data.gesture !== GestureType.ROCK) {
       // Allow core gestures to bypass if not in the map, otherwise check map
       if (gestureSettings[data.gesture] === false) {
           setHandData({ ...data, gesture: GestureType.NONE });
           return;
       }
    }
    setHandData(data);
  }, [gestureSettings]);

  // Update object properties
  const handleUpdateObject = (id: string, updates: Partial<SceneObject>) => {
    setObjects(prev => prev.map(obj => obj.id === id ? { ...obj, ...updates } : obj));
  };

  // Import Project Logic
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json)) {
          // Basic validation to ensure it looks like SceneObject[]
          const isValid = json.every(item => item.id && item.type && item.position && item.rotation && item.scale && item.color);
          if (isValid) {
            setObjects(json);
            setSelectedId(null);
            setMode(AppMode.VIEW);
            alert("Project imported successfully!");
          } else {
            alert("Invalid project file structure.");
          }
        } else {
          alert("Invalid JSON format.");
        }
      } catch (err) {
        console.error("Import failed", err);
        alert("Failed to parse project file.");
      }
    };
    reader.readAsText(file);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 1. GESTURE LOGIC LOOP
  useEffect(() => {
    if (!handData) {
      setHoldStart(null);
      setActiveProgress(null);
      return;
    }

    const now = Date.now();
    const g = handData.gesture;

    // --- LOGIC: Universal Hold Detection ---
    let currentTargetAction = null;
    let targetLabel = '';

    if (g === GestureType.SHAKA) {
       currentTargetAction = 'CANCEL';
       targetLabel = 'Canceling...';
    } 
    else if (g === GestureType.ROCK) { // Re-mapped to SETTINGS (Control Panel)
       currentTargetAction = 'SETTINGS';
       targetLabel = 'Control Panel...';
    }
    else if (g === GestureType.VICTORY && mode !== AppMode.MENU && mode !== AppMode.PLACING) {
       currentTargetAction = 'MENU';
       targetLabel = 'Opening Menu...';
    }
    else if (g === GestureType.THREE_FINGERS && selectedId && mode !== AppMode.RADIAL) {
       currentTargetAction = 'RADIAL';
       targetLabel = 'Radial Tools...';
    }

    // Process Hold
    if (currentTargetAction) {
       if (!holdStart || holdStart.type !== g) {
          setHoldStart({ type: g, time: now });
          setActiveProgress({ label: targetLabel, value: 0 });
       } else {
          const elapsed = now - holdStart.time;
          const progress = Math.min(elapsed / HOLD_DURATION, 1);
          setActiveProgress({ label: targetLabel, value: progress * 100 });

          if (elapsed >= HOLD_DURATION) {
             if (currentTargetAction === 'CANCEL') {
                setMode(AppMode.VIEW);
                setSelectedId(null);
                setPendingObjectType(null);
             }
             else if (currentTargetAction === 'SETTINGS') {
                setMode(AppMode.SETTINGS);
             }
             else if (currentTargetAction === 'MENU') {
                setMode(AppMode.MENU);
             }
             else if (currentTargetAction === 'RADIAL') {
                setMode(AppMode.RADIAL);
             }
             
             setHoldStart(null);
             setActiveProgress(null);
          }
       }
    } else {
       setHoldStart(null);
       setActiveProgress(null);
    }


    // --- LOGIC: Radial Menu Interaction (5 Slices) ---
    // Use Screen Coordinates for accurate angle calculation relative to center
    if (mode === AppMode.RADIAL) {
       const screenX = ((handData.x + 1) / 2) * window.innerWidth;
       const screenY = ((1 - handData.y) / 2) * window.innerHeight;
       const centerX = window.innerWidth / 2;
       const centerY = window.innerHeight / 2;
       
       const dx = screenX - centerX;
       const dy = screenY - centerY;
       const dist = Math.sqrt(dx*dx + dy*dy);
       
       // Only activate if pointer is away from dead center to avoid jitter
       if (dist > 50) {
          // Calculate angle in radians. 
          // Atan2(y, x): 0 is Right, 90 is Down (Screen Y is down positive), -90 is Up, 180 is Left.
          let theta = Math.atan2(dy, dx);
          let deg = theta * (180 / Math.PI);
          
          // We want 0 degrees to be at the TOP.
          // Currently Top is -90.
          // Add 90 to make Top 0.
          let clockDeg = deg + 90;
          if (clockDeg < 0) clockDeg += 360;

          // 5 Slices = 72 degrees each.
          // Slice 0: 324 -> 36 (Top) -> MOVE
          // Slice 1: 36 -> 108 (Right) -> ROTATE
          // Slice 2: 108 -> 180 (Bottom Right) -> SCALE
          // Slice 3: 180 -> 252 (Bottom Left) -> COLOR
          // Slice 4: 252 -> 324 (Top Left) -> DELETE

          let sector: 'move' | 'rotate' | 'scale' | 'color' | 'delete' | null = null;

          if (clockDeg >= 324 || clockDeg < 36) sector = 'move';
          else if (clockDeg >= 36 && clockDeg < 108) sector = 'rotate';
          else if (clockDeg >= 108 && clockDeg < 180) sector = 'scale';
          else if (clockDeg >= 180 && clockDeg < 252) sector = 'color';
          else if (clockDeg >= 252 && clockDeg < 324) sector = 'delete';

          setActiveRadialSector(sector);

          if (handData.isPinching) {
             if (sector === 'move') { setTransformMode('translate'); setMode(AppMode.EDIT); }
             else if (sector === 'rotate') { setTransformMode('rotate'); setMode(AppMode.EDIT); }
             else if (sector === 'scale') { setTransformMode('scale'); setMode(AppMode.EDIT); }
             else if (sector === 'color') { setTransformMode('color'); setMode(AppMode.EDIT); }
             else if (sector === 'delete') {
                if (selectedId) {
                   setObjects(prev => prev.filter(o => o.id !== selectedId));
                   setSelectedId(null);
                }
                setMode(AppMode.VIEW);
             }
          }
       } else {
          setActiveRadialSector(null);
       }
    }

    // --- LOGIC: 2D Interaction in MENU, HUB or SETTINGS Mode ---
    if ((mode === AppMode.MENU || mode === AppMode.HUB || mode === AppMode.SETTINGS) && handData.isPinching) {
       const screenX = ((handData.x + 1) / 2) * window.innerWidth;
       const screenY = ((1 - handData.y) / 2) * window.innerHeight;
       const element = document.elementFromPoint(screenX, screenY);
       
       if (element) {
          const type = element.getAttribute('data-create-type');
          if (type) {
             setPendingObjectType(type as any);
             setMode(AppMode.PLACING); 
          }

          const hubAction = element.getAttribute('data-hub-tab');
          if (hubAction) {
             setHubTab(hubAction as 'guide' | 'ai');
          }
       }
       
       if (mode === AppMode.HUB && !element?.getAttribute('data-hub-tab') && !hubPinchCooldown) {
           setHubTab(prev => prev === 'guide' ? 'ai' : 'guide');
           setHubPinchCooldown(true);
           setTimeout(() => setHubPinchCooldown(false), 800);
       }
    }

  }, [handData, mode, holdStart, selectedId, activeRadialSector, hubPinchCooldown]);

  const handlePlaceObject = (position: [number, number, number]) => {
     if (!pendingObjectType) return;

     const newId = `obj-${Date.now()}`;
     const newObj: SceneObject = {
        id: newId,
        type: pendingObjectType,
        position: position,
        rotation: [0,0,0],
        scale: [1,1,1],
        color: '#ffffff'
     };

     setObjects(prev => [...prev, newObj]);
     setSelectedId(newId);
     setMode(AppMode.EDIT); 
     setPendingObjectType(null);
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMsg = chatInput;
    setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
    setChatInput('');
    setIsChatLoading(true);

    const answer = await askProjectQuestion(userMsg);
    
    setChatHistory(prev => [...prev, { role: 'ai', text: answer }]);
    setIsChatLoading(false);
  };

  const handleDownloadJSON = () => {
     const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(objects, null, 2));
     const link = document.createElement('a');
     link.href = dataStr;
     link.download = "gesture-flow-project.json";
     link.click();
  };

  const renderVirtualCursor = () => {
     if ((mode === AppMode.MENU || mode === AppMode.RADIAL || mode === AppMode.HUB || mode === AppMode.SETTINGS) && handData) {
        const screenX = ((handData.x + 1) / 2) * window.innerWidth;
        const screenY = ((1 - handData.y) / 2) * window.innerHeight;
        
        return (
           <div 
             className="absolute w-8 h-8 pointer-events-none z-50 transform -translate-x-1/2 -translate-y-1/2"
             style={{ left: screenX, top: screenY }}
           >
              <div className={`w-full h-full border-2 rounded-full flex items-center justify-center ${handData.isPinching ? 'border-red-500 bg-red-500/20 scale-90' : 'border-white bg-white/20'}`}>
                 <div className="w-1 h-1 bg-white rounded-full"></div>
              </div>
           </div>
        )
     }
     return null;
  };

  // Helper to draw Radial Sector
  const RadialSlice = ({ id, label, icon: Icon, startAngle, endAngle, active, color }: any) => {
     // Convert degrees to radians
     const startRad = (startAngle - 90) * (Math.PI / 180);
     const endRad = (endAngle - 90) * (Math.PI / 180);
     
     // Calculate coordinates
     const r = 200; // Radius
     const x1 = Math.cos(startRad) * r;
     const y1 = Math.sin(startRad) * r;
     const x2 = Math.cos(endRad) * r;
     const y2 = Math.sin(endRad) * r;
     
     // SVG Path for slice
     const pathData = `M 0 0 L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`;

     // Icon Position (midpoint)
     const midAng = (startAngle + endAngle) / 2;
     const midRad = (midAng - 90) * (Math.PI / 180);
     const iconR = 120;
     const iconX = Math.cos(midRad) * iconR;
     const iconY = Math.sin(midRad) * iconR;

     return (
        <g className="cursor-pointer transition-all duration-300">
           <path 
              d={pathData} 
              fill={active ? color : 'rgba(15, 23, 42, 0.8)'}
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="1"
              className="transition-all duration-200"
              style={{ filter: active ? `drop-shadow(0 0 20px ${color})` : 'none' }}
           />
           <foreignObject x={iconX - 30} y={iconY - 30} width="60" height="60">
              <div className={`flex flex-col items-center justify-center h-full text-white ${active ? 'scale-110' : 'opacity-70'}`}>
                 <Icon size={28} />
                 <span className="text-[10px] font-bold mt-1 uppercase">{label}</span>
              </div>
           </foreignObject>
        </g>
     );
  };

  const gestures = [
    { type: GestureType.POINTING, emoji: '☝️', label: 'Point', active: handData?.gesture === GestureType.POINTING },
    { type: GestureType.PINCH, emoji: '🤏', label: 'Interact', active: handData?.isPinching },
    { type: GestureType.VICTORY, emoji: '✌️', label: 'Create Menu', active: handData?.gesture === GestureType.VICTORY },
    { type: GestureType.THUMBS_UP, emoji: '👍', label: 'Zoom In', active: handData?.gesture === GestureType.THUMBS_UP },
    { type: GestureType.THUMB_DOWN, emoji: '👎', label: 'Zoom Out', active: handData?.gesture === GestureType.THUMB_DOWN },
    { type: GestureType.THREE_FINGERS, emoji: '3️⃣', label: 'Tools (Select Object Only)', active: handData?.gesture === GestureType.THREE_FINGERS },
    { type: GestureType.ROCK, emoji: '🤘', label: 'Control Panel', active: handData?.gesture === GestureType.ROCK },
    { type: GestureType.SHAKA, emoji: '🤙', label: 'Cancel', active: handData?.gesture === GestureType.SHAKA },
  ];

  return (
    <div className="relative w-screen h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-800 via-gray-900 to-black overflow-hidden select-none text-white font-sans">
      
      {/* 3D Scene Layer */}
      <div className={`absolute inset-0 z-0 transition-opacity duration-300 ${mode === AppMode.RADIAL || mode === AppMode.HUB || mode === AppMode.SETTINGS ? 'opacity-50 blur-sm' : 'opacity-100'}`}>
        <Scene3D 
          objects={objects} 
          handData={handData} 
          mode={mode} 
          selectedId={selectedId}
          transformMode={transformMode}
          sensitivity={sensitivity}
          onSelect={setSelectedId}
          onUpdateObject={handleUpdateObject}
          pendingObjectType={pendingObjectType}
          onPlaceObject={handlePlaceObject}
          exportRequest={exportRequest}
          onExportComplete={() => setExportRequest(null)}
        />
      </div>

      {renderVirtualCursor()}

      {/* TOP HEADER */}
      <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start z-10 pointer-events-none">
        
        {/* Title Badge */}
        <div className="glass-panel px-5 py-3 rounded-2xl flex items-center space-x-3 pointer-events-auto shadow-lg shadow-blue-500/10 border border-blue-500/20">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
               <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
               <h1 className="text-lg font-bold tracking-tight text-white">GESTURE FLOW</h1>
            </div>
            <span className="text-[10px] text-blue-300 uppercase tracking-widest font-semibold ml-4 opacity-80">
               Next Gen Modeling
            </span>
          </div>
        </div>

        {/* Right Side Controls */}
        <div className="pointer-events-auto flex flex-col gap-3 items-end">
           <HandTracker onHandUpdate={handleHandUpdate} />
           
           <div className="glass-panel p-3 rounded-xl flex flex-col gap-2 w-48 shadow-lg">
              <div className="flex justify-between items-center text-[10px] text-gray-300 uppercase tracking-wider font-semibold">
                <div className="flex items-center gap-1"><Gauge size={12} /> Sensitivity</div>
                <span className="text-blue-400">{sensitivity.toFixed(1)}x</span>
              </div>
              <input 
                 type="range" 
                 min="0.1" 
                 max="4.0" 
                 step="0.1" 
                 value={sensitivity} 
                 onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                 className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-colors"
              />
           </div>

           {/* ACTIVE ACTION PROGRESS BAR */}
           {activeProgress && (
             <div className="glass-panel px-4 py-3 rounded-xl flex flex-col gap-1 w-48 shadow-lg animate-in fade-in slide-in-from-right-4">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-white">
                   <span>{activeProgress.label}</span>
                   <span>{Math.round(activeProgress.value)}%</span>
                </div>
                <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                   <div 
                      className={`h-full transition-all duration-75 ease-linear ${activeProgress.label.includes('Delete') || activeProgress.label.includes('Cancel') ? 'bg-red-500' : 'bg-blue-500'}`} 
                      style={{ width: `${activeProgress.value}%` }}
                   ></div>
                </div>
             </div>
           )}
           
           <div className="inline-flex items-center space-x-2 bg-black/40 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
              <span className={`w-1.5 h-1.5 rounded-full ${handData ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]' : 'bg-red-500'}`}></span>
              <span className="text-[10px] font-mono text-gray-400 uppercase">
                {handData ? `${handData.gesture}` : 'NO HAND'}
              </span>
           </div>
        </div>
      </div>

      {/* CONTROL PANEL (Formerly Config) & EXPORT MENU */}
      {mode === AppMode.SETTINGS && (
         <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in p-4">
             <div className="glass-panel w-full max-w-4xl p-8 rounded-3xl border border-white/10 shadow-2xl relative overflow-y-auto max-h-[90vh]">
                <button onClick={() => setMode(AppMode.VIEW)} className="absolute top-6 right-6 p-2 bg-white/5 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-all">
                   <X size={24} />
                </button>

                <h2 className="text-2xl font-bold mb-8 flex items-center gap-3">
                   <Settings className="text-blue-400" /> 
                   Control Panel
                </h2>

                <div className="grid grid-cols-2 gap-12">
                   
                   {/* GESTURE TOGGLES */}
                   <div>
                      <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-4 border-b border-white/10 pb-2">
                         Gesture Control
                      </h3>
                      <div className="space-y-3">
                         {Object.keys(gestureSettings).map(key => (
                            <div key={key} className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                               <span className="text-sm font-medium">{key.replace('_', ' ')}</span>
                               <button 
                                  onClick={() => setGestureSettings(prev => ({...prev, [key]: !prev[key]}))}
                                  className={`w-12 h-6 rounded-full relative transition-colors duration-200 ${gestureSettings[key] ? 'bg-blue-600' : 'bg-gray-600'}`}
                               >
                                  <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${gestureSettings[key] ? 'translate-x-6' : 'translate-x-0'}`}></div>
                               </button>
                            </div>
                         ))}
                      </div>

                      {/* HELP CENTER BUTTON */}
                      <button 
                         onClick={() => setMode(AppMode.HUB)}
                         className="mt-6 w-full p-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl flex items-center justify-center gap-3 transition-all hover:scale-[1.02] active:scale-95 shadow-lg"
                      >
                         <HelpIcon size={20} className="text-white" />
                         <span className="font-bold text-sm">Open Help Center</span>
                      </button>
                   </div>

                   {/* IMPORT & EXPORT STUDIO */}
                   <div>
                      <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-4 border-b border-white/10 pb-2">
                         Data Management
                      </h3>
                      <div className="grid grid-cols-1 gap-4">
                         
                         {/* IMPORT */}
                         <input 
                            type="file" 
                            ref={fileInputRef} 
                            onChange={handleFileChange} 
                            accept=".json" 
                            className="hidden" 
                         />
                         <button 
                            onClick={handleImportClick}
                            className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl flex items-center gap-4 transition-all hover:scale-105 active:scale-95 text-left"
                         >
                            <div className="p-3 bg-orange-500/20 rounded-lg text-orange-400"><Upload size={24} /></div>
                            <div>
                               <div className="font-bold text-sm">Import Project</div>
                               <div className="text-[10px] text-gray-500">Load existing project JSON</div>
                            </div>
                         </button>

                         {/* EXPORTS */}
                         <button 
                            onClick={() => setExportRequest('image')}
                            className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl flex items-center gap-4 transition-all hover:scale-105 active:scale-95 text-left"
                         >
                            <div className="p-3 bg-blue-500/20 rounded-lg text-blue-400"><ImageIcon size={24} /></div>
                            <div>
                               <div className="font-bold text-sm">Download Screenshot</div>
                               <div className="text-[10px] text-gray-500">Save current view as PNG</div>
                            </div>
                         </button>

                         <button 
                            onClick={() => setExportRequest('gltf')}
                            className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl flex items-center gap-4 transition-all hover:scale-105 active:scale-95 text-left"
                         >
                            <div className="p-3 bg-purple-500/20 rounded-lg text-purple-400"><Box size={24} /></div>
                            <div>
                               <div className="font-bold text-sm">Export 3D Model (GLTF)</div>
                               <div className="text-[10px] text-gray-500">Compatible with Blender/Unity</div>
                            </div>
                         </button>

                         <button 
                            onClick={handleDownloadJSON}
                            className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl flex items-center gap-4 transition-all hover:scale-105 active:scale-95 text-left"
                         >
                            <div className="p-3 bg-green-500/20 rounded-lg text-green-400"><FileJson size={24} /></div>
                            <div>
                               <div className="font-bold text-sm">Save Project JSON</div>
                               <div className="text-[10px] text-gray-500">Raw scene data for backup</div>
                            </div>
                         </button>
                      </div>
                   </div>

                </div>
             </div>
         </div>
      )}

      {/* RADIAL MENU (SVG BASED) */}
      {mode === AppMode.RADIAL && (
         <div className="absolute inset-0 z-30 flex items-center justify-center animate-in zoom-in duration-200">
            <div className="relative w-[500px] h-[500px] flex items-center justify-center">
               
               {/* Center Hub */}
               <div className="absolute z-20 w-32 h-32 rounded-full bg-black border-2 border-white/20 flex flex-col items-center justify-center shadow-2xl backdrop-blur-xl">
                  <span className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Pinch To</span>
                  <span className="font-bold text-white text-xl">SELECT</span>
               </div>

               {/* SVG Wheel */}
               <svg viewBox="-200 -200 400 400" className="w-full h-full absolute top-0 left-0 z-10 overflow-visible">
                  <RadialSlice id="move" label="Move" icon={Move} startAngle={-36} endAngle={36} active={activeRadialSector === 'move'} color="#3b82f6" />
                  <RadialSlice id="rotate" label="Rotate" icon={RotateCw} startAngle={36} endAngle={108} active={activeRadialSector === 'rotate'} color="#eab308" />
                  <RadialSlice id="scale" label="Scale" icon={Maximize2} startAngle={108} endAngle={180} active={activeRadialSector === 'scale'} color="#22c55e" />
                  <RadialSlice id="color" label="Color" icon={Palette} startAngle={180} endAngle={252} active={activeRadialSector === 'color'} color="#a855f7" />
                  <RadialSlice id="delete" label="Delete" icon={Trash2} startAngle={252} endAngle={324} active={activeRadialSector === 'delete'} color="#ef4444" />
               </svg>

               <div className="absolute -bottom-12 w-full text-center text-red-400 text-sm animate-pulse">
                  Hold <span className="font-bold">🤙 (Shaka)</span> to Cancel
               </div>
            </div>
         </div>
      )}

      {/* CREATION MENU */}
      {mode === AppMode.MENU && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
           <div className="glass-panel p-8 rounded-3xl border border-white/10 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"></div>
              <h2 className="text-2xl font-bold text-center mb-8 text-white tracking-tight">Create Object</h2>
              <div className="grid grid-cols-2 gap-6">
                 {[
                    { id: 'box', icon: Square, label: 'Box', color: 'text-blue-400' },
                    { id: 'sphere', icon: Circle, label: 'Sphere', color: 'text-red-400' },
                    { id: 'torus', icon: Disc, label: 'Torus', color: 'text-green-400' },
                    { id: 'cone', icon: Triangle, label: 'Cone', color: 'text-yellow-400' }
                 ].map(item => (
                    <button key={item.id} id={`btn-${item.id}`} data-create-type={item.id} className="p-6 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-2xl flex flex-col items-center gap-4 transition-all hover:scale-105 group active:scale-95">
                       <item.icon size={40} className={`${item.color} group-hover:brightness-125 transition-all`} />
                       <span className="text-sm font-medium tracking-wide">{item.label}</span>
                    </button>
                 ))}
              </div>
              <div className="mt-8 text-center text-[10px] text-gray-500 uppercase tracking-widest">
                 Pinch to Select • Hold 🤙 to Close
              </div>
           </div>
        </div>
      )}

      {/* SELECTED OBJECT INFO */}
      {selectedId && mode !== AppMode.MENU && mode !== AppMode.RADIAL && mode !== AppMode.HUB && mode !== AppMode.SETTINGS && (
        <div className="absolute bottom-40 left-8 z-10 glass-panel p-4 rounded-xl w-64 pointer-events-auto transition-all duration-300 border border-white/10 shadow-xl">
          <div className="flex justify-between items-center mb-4 pb-2 border-b border-white/5">
             <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <h3 className="font-semibold text-sm text-white">Active Object</h3>
             </div>
             <span className="text-[10px] text-gray-500 font-mono bg-white/5 px-2 py-0.5 rounded">{selectedId.split('-')[1]}</span>
          </div>
          
          <div className="grid grid-cols-4 gap-2 mb-3">
             {[
                { id: 'translate', icon: Move, color: 'text-blue-400' },
                { id: 'rotate', icon: RotateCw, color: 'text-yellow-400' },
                { id: 'scale', icon: Maximize2, color: 'text-green-400' },
                { id: 'color', icon: Palette, color: 'text-purple-400' },
             ].map(tool => (
                <button 
                  key={tool.id}
                  onClick={() => setTransformMode(tool.id as any)} 
                  className={`p-2.5 rounded-lg flex items-center justify-center transition-all ${transformMode === tool.id ? 'bg-white/15 shadow-inner' : 'hover:bg-white/5'}`}
                >
                   <tool.icon size={16} className={transformMode === tool.id ? 'text-white' : 'text-gray-500'} />
                </button>
             ))}
          </div>
        </div>
      )}

      {/* BOTTOM FLOATING BAR */}
      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-10 w-full max-w-[90%] pointer-events-none">
          <div className="glass-panel rounded-full p-4 flex justify-between items-center shadow-2xl bg-black/80 border border-white/20 backdrop-blur-xl">
             {gestures.map((g, i) => (
                <div key={i} className={`flex flex-col md:flex-row items-center space-x-0 md:space-x-3 px-4 py-2 rounded-full transition-all duration-300 ${g.active ? 'bg-white/20 text-white scale-110 shadow-lg border border-white/20' : 'text-gray-500 opacity-60 scale-100'}`}>
                   <span className="text-3xl filter drop-shadow-lg">{g.emoji}</span>
                   <span className="text-[10px] md:text-xs font-bold uppercase tracking-wider hidden md:inline-block max-w-[80px] md:max-w-none text-center leading-tight">
                      {g.label}
                   </span>
                </div>
             ))}
          </div>
      </div>

      {/* HELPER TEXT OVERLAY FOR RADIAL TOOLS TIP */}
      {selectedId && !handData?.isPinching && mode === AppMode.EDIT && (
         <div className="absolute bottom-32 left-1/2 transform -translate-x-1/2 text-[10px] text-gray-500 bg-black/60 px-3 py-1 rounded-full backdrop-blur-sm pointer-events-none">
            Tip: Hold 3️⃣ to open Radial Menu for selected object
         </div>
      )}

      {/* SMART HUB (COMBINED AI & GUIDE) */}
      {mode === AppMode.HUB && (
         <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in p-4">
             <div className="glass-panel w-full max-w-5xl h-[85vh] rounded-3xl border border-white/10 shadow-2xl flex flex-col overflow-hidden bg-[#0f0f11] relative">
                
                {/* Close Overlay */}
                <button onClick={() => setMode(AppMode.SETTINGS)} className="absolute top-6 right-6 p-2 bg-white/5 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-all z-20">
                   <X size={24} />
                </button>

                <div className="flex flex-col h-full relative">
                   {/* HUB SIDEBAR */}
                   <div className="w-full h-16 border-b border-white/5 flex items-center px-8 justify-between bg-black/20">
                      <div className="flex items-center gap-3">
                         <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <HelpIcon size={20} className="text-white" />
                         </div>
                         <h2 className="text-xl font-bold tracking-tight">Help Center</h2>
                      </div>
                      
                      <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
                         <button 
                            data-hub-tab="guide"
                            onClick={() => setHubTab('guide')}
                            className={`px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${hubTab === 'guide' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:text-white'}`}
                         >
                            <BookOpen size={14} /> Guide
                         </button>
                         <button 
                            data-hub-tab="ai"
                            onClick={() => setHubTab('ai')}
                            className={`px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${hubTab === 'ai' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-500 hover:text-white'}`}
                         >
                            <MessageSquare size={14} /> AI Assistant
                         </button>
                      </div>
                   </div>

                   {/* HUB CONTENT */}
                   <div className="flex-1 overflow-y-auto p-8 relative">
                      
                      {/* GUIDE TAB */}
                      {hubTab === 'guide' && (
                         <div className="grid grid-cols-2 gap-8 animate-in slide-in-from-bottom-4 duration-300">
                             
                             {/* Getting Started */}
                             <div className="space-y-6">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                   <div className="w-1 h-6 bg-blue-500 rounded-full"></div> 
                                   Getting Started
                                </h3>
                                <div className="space-y-4">
                                   <div className="bg-white/5 p-4 rounded-xl border border-white/5 flex gap-4 items-start">
                                      <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400"><Hand size={20} /></div>
                                      <div>
                                         <h4 className="font-bold text-sm mb-1">Hand Tracking</h4>
                                         <p className="text-xs text-gray-400 leading-relaxed">Ensure your hand is visible in the camera. Use good lighting. The tracker detects 21 landmarks to interpret your gestures in real-time.</p>
                                      </div>
                                   </div>
                                   <div className="bg-white/5 p-4 rounded-xl border border-white/5 flex gap-4 items-start">
                                      <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400"><Layers size={20} /></div>
                                      <div>
                                         <h4 className="font-bold text-sm mb-1">Modes</h4>
                                         <p className="text-xs text-gray-400 leading-relaxed">The app switches modes automatically based on gestures. "View" for camera control, "Edit" for object manipulation, and "Menu" for creation.</p>
                                      </div>
                                   </div>
                                </div>
                             </div>

                             {/* Gesture Guide */}
                             <div className="space-y-6">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                   <div className="w-1 h-6 bg-green-500 rounded-full"></div> 
                                   Mastering Gestures
                                </h3>
                                <div className="grid grid-cols-2 gap-3">
                                   {[
                                      { icon: '☝️', name: 'Point', desc: 'Move Cursor' },
                                      { icon: '🤏', name: 'Pinch', desc: 'Interact / Grab' },
                                      { icon: '✌️', name: 'Victory', desc: 'Create Menu (Hold)' },
                                      { icon: '3️⃣', name: '3 Fingers', desc: 'Radial Tools (Hold)' },
                                      { icon: '👍', name: 'Thumb Up', desc: 'Zoom In' },
                                      { icon: '👎', name: 'Thumb Down', desc: 'Zoom Out' },
                                      { icon: '🤘', name: 'Rock', desc: 'Control Panel (Hold)' },
                                      { icon: '🤙', name: 'Shaka', desc: 'Cancel / Back (Hold)' },
                                   ].map((g, i) => (
                                      <div key={i} className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5">
                                         <span className="text-2xl">{g.icon}</span>
                                         <div>
                                            <div className="font-bold text-xs">{g.name}</div>
                                            <div className="text-[10px] text-gray-500">{g.desc}</div>
                                         </div>
                                      </div>
                                   ))}
                                </div>
                             </div>
                         </div>
                      )}

                      {/* AI TAB */}
                      {hubTab === 'ai' && (
                         <div className="h-full flex flex-col animate-in slide-in-from-bottom-4 duration-300">
                            <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
                               {chatHistory.length === 0 && (
                                  <div className="h-full flex flex-col items-center justify-center text-gray-500 opacity-50">
                                     <Code size={48} className="mb-4" />
                                     <p>Ask me anything about the codebase or how to use the app.</p>
                                  </div>
                               )}
                               {chatHistory.map((msg, idx) => (
                                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                     <div className={`max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white/10 text-gray-200 rounded-bl-none'}`}>
                                        {msg.text}
                                     </div>
                                  </div>
                               ))}
                               {isChatLoading && (
                                  <div className="flex justify-start">
                                     <div className="bg-white/10 p-4 rounded-2xl rounded-bl-none flex gap-2 items-center">
                                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100"></div>
                                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200"></div>
                                     </div>
                                  </div>
                               )}
                            </div>
                            
                            <form onSubmit={handleChatSubmit} className="relative">
                               <input 
                                  type="text" 
                                  value={chatInput}
                                  onChange={(e) => setChatInput(e.target.value)}
                                  placeholder="Type your question..."
                                  className="w-full bg-black/30 border border-white/10 rounded-xl py-4 px-6 text-white focus:outline-none focus:border-blue-500/50 focus:border-ring focus:ring-blue-500/50 transition-all"
                               />
                               <button type="submit" className="absolute right-2 top-2 p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
                                  <MessageSquare size={20} />
                               </button>
                            </form>
                         </div>
                      )}

                      <div className="absolute bottom-4 left-0 right-0 text-center pointer-events-none">
                          <span className="text-[10px] text-red-400 uppercase tracking-widest bg-black/60 px-3 py-1 rounded-full backdrop-blur">
                             Hint: Pinch air to switch tabs
                          </span>
                      </div>

                   </div>
                </div>
             </div>
         </div>
      )}

    </div>
  );
}
