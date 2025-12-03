
import React, { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker, DrawingUtils, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { GestureType, HandData } from '../types';
import { PINCH_THRESHOLD } from '../constants';

interface HandTrackerProps {
  onHandUpdate: (data: HandData | null) => void;
}

const HandTracker: React.FC<HandTrackerProps> = ({ onHandUpdate }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number>(0);
  const onHandUpdateRef = useRef(onHandUpdate);

  useEffect(() => {
    onHandUpdateRef.current = onHandUpdate;
  }, [onHandUpdate]);

  // Initialize MediaPipe
  useEffect(() => {
    const init = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        
        landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
        
        setLoading(false);
        startCamera();
      } catch (err) {
        console.error("Failed to load MediaPipe:", err);
      }
    };
    init();
    
    return () => {
       if (landmarkerRef.current) landmarkerRef.current.close();
       cancelAnimationFrame(requestRef.current);
    };
  }, []);

  const startCamera = async () => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && videoRef.current) {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 320, height: 240 }
      });
      videoRef.current.srcObject = stream;
      videoRef.current.addEventListener('loadeddata', predictWebcam);
    }
  };

  const predictWebcam = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;

    if (!video || !canvas || !landmarker) return;

    // Detect
    const startTimeMs = performance.now();
    if (video.currentTime > 0) {
      const result = landmarker.detectForVideo(video, startTimeMs);
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const drawingUtils = new DrawingUtils(ctx);
        
        if (result.landmarks && result.landmarks.length > 0) {
          const landmarks = result.landmarks[0];
          
          // Draw skeleton
          drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: "#00FF00", lineWidth: 2 });
          drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });

          // --- ROBUST GESTURE RECOGNITION LOGIC ---
          
          // 1. Calculate Distances Helper
          const getDist = (p1: NormalizedLandmark, p2: NormalizedLandmark) => {
            return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
          };

          const wrist = landmarks[0];
          const thumbTip = landmarks[4];
          const thumbIp = landmarks[3]; // Joint below tip
          const indexTip = landmarks[8];
          const indexPip = landmarks[6]; // Knuckle
          const middleTip = landmarks[12];
          const middlePip = landmarks[10];
          const ringTip = landmarks[16];
          const ringPip = landmarks[14];
          const pinkyTip = landmarks[20];
          const pinkyPip = landmarks[18];

          // 2. Determine Finger States (Extended vs Curled)
          // Using pip-to-wrist vs tip-to-wrist comparison for robust extension check
          const isIndexExt = getDist(indexTip, wrist) > getDist(indexPip, wrist);
          const isMiddleExt = getDist(middleTip, wrist) > getDist(middlePip, wrist);
          const isRingExt = getDist(ringTip, wrist) > getDist(ringPip, wrist);
          const isPinkyExt = getDist(pinkyTip, wrist) > getDist(pinkyPip, wrist);
          
          // Thumb Logic
          const isThumbFar = getDist(thumbTip, indexPip) > 0.05;
          const isThumbCurled = !isThumbFar; 

          // Thumb Direction
          const isThumbUp = thumbTip.y < thumbIp.y;
          const isThumbDown = thumbTip.y > thumbIp.y;

          // 3. Calculate Pinches
          const pinchDist = getDist(thumbTip, indexTip);
          const isPinching = pinchDist < PINCH_THRESHOLD;

          let gesture = GestureType.NONE;

          // 4. Decision Tree (Priority Based)

          // 1. CANCEL / SHAKA (Thumb + Pinky)
          // STRICT: Thumb MUST be Extended. Index, Middle, Ring MUST be Curled.
          if (isThumbFar && isPinkyExt && !isIndexExt && !isMiddleExt && !isRingExt) {
            gesture = GestureType.SHAKA;
          }
          // 2. INTERACT / PINCH (Index + Thumb touching)
          else if (isPinching) {
             gesture = GestureType.PINCH;
          }
          // 3. CREATE (VICTORY: Index + Middle pointing OUT)
          // RELAXED: Thumb state ignored. Ring & Pinky MUST be Curled.
          else if (isIndexExt && isMiddleExt && !isRingExt && !isPinkyExt) {
             gesture = GestureType.VICTORY; 
          }
          // 4. CONFIG (ROCK/HORNS: Index + Pinky)
          // RELAXED: Thumb state ignored. Middle & Ring MUST be Curled.
          else if (isIndexExt && isPinkyExt && !isMiddleExt && !isRingExt) {
             gesture = GestureType.ROCK;
          }
          // 5. ZOOM IN (Thumbs Up)
          // STRICT: All fingers curled, Thumb Extended UP & FAR
          else if (!isIndexExt && !isMiddleExt && !isRingExt && !isPinkyExt && isThumbFar && isThumbUp) {
             gesture = GestureType.THUMBS_UP;
          }
          // 6. ZOOM OUT (Thumbs Down)
          // STRICT: All fingers curled, Thumb Extended DOWN & FAR
          else if (!isIndexExt && !isMiddleExt && !isRingExt && !isPinkyExt && isThumbFar && isThumbDown) {
             gesture = GestureType.THUMB_DOWN;
          }
          // 7. RADIAL TOOLS (3 Fingers)
          // STRICT: Index, Middle, Ring Ext. Pinky Curled.
          else if (isIndexExt && isMiddleExt && isRingExt && !isPinkyExt) {
             gesture = GestureType.THREE_FINGERS;
          }
          // 8. POINTING (Index only)
          else if (isIndexExt && !isMiddleExt && !isRingExt && !isPinkyExt) {
             gesture = GestureType.POINTING;
          }
          
          // Normalize coordinates (-1 to 1) for 3D space
          // MediaPipe X is 0-1. In selfie mode: 0 is Left, 1 is Right.
          // We want -1 Left, 1 Right.
          // (x * 2 - 1) -> -1 to 1.
          // Note: If scale-x-[-1] is applied to canvas, the visual feed is mirrored.
          // If we want natural interaction (Hand moves right -> Cursor moves right), we map 0->Left(-1), 1->Right(1).
          const normX = (indexTip.x * 2 - 1) * -1; // Invert to match mirrored video
          const normY = (indexTip.y * 2 - 1) * -1; // Invert Y (1 top, -1 bottom for 3D)

          if (onHandUpdateRef.current) {
            onHandUpdateRef.current({
              x: normX,
              y: normY,
              gesture,
              pinchDistance: pinchDist,
              isPinching
            });
          }

        } else {
          if (onHandUpdateRef.current) onHandUpdateRef.current(null);
        }
      }
    }
    
    requestRef.current = requestAnimationFrame(predictWebcam);
  };

  return (
    <div className="relative w-48 h-36 rounded-xl overflow-hidden border border-white/20 shadow-2xl bg-black">
      {loading && <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">Init AI...</div>}
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover transform scale-x-[-1]" />
      <canvas ref={canvasRef} width={320} height={240} className="absolute inset-0 w-full h-full transform scale-x-[-1]" />
      <div className="absolute bottom-1 right-1 px-2 py-0.5 bg-black/60 text-[10px] text-white rounded">
        Input
      </div>
    </div>
  );
};

export default HandTracker;
