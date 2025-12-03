import { GoogleGenAI, Type } from "@google/genai";
import { AIGeneratedCommand } from "../types";

const apiKey = process.env.API_KEY || ''; 
// Note: In a real deployment, ensure API_KEY is handled securely. 
// For this demo, we assume the environment variable is injected.

const ai = new GoogleGenAI({ apiKey });

const modelName = 'gemini-2.5-flash';

const systemInstruction = `
You are an AI Assistant for a 3D modeling software called "Gesture Flow".
Your job is to interpret user natural language requests and convert them into structured JSON commands to manipulate the 3D scene.

Coordinate System & Directions:
- Right: +X | Left: -X
- Up: +Y | Down: -Y
- Backward (Towards Camera): +Z | Forward (Into Screen/Away): -Z

Supported Actions:

1. 'create':
   - params: { type: 'box'|'sphere'|'torus'|'cone', position: [x,y,z], color: string }
   - Default position: [0, 1, 0]. Default color: '#ffffff'.

2. 'move' (Translation):
   - params: { vector: [x, y, z], id: 'selected' or object_id }
   - 'vector' is a RELATIVE displacement.
   - "move left 3" -> vector: [-3, 0, 0]
   - "move up 2" -> vector: [0, 2, 0]
   - "move forward 5" -> vector: [0, 0, -5]

3. 'rotate' (Rotation):
   - params: { vector: [x, y, z], id: 'selected' or object_id }
   - 'vector' represents RELATIVE Euler angles in DEGREES.
   - "rotate 90 degrees Y" -> vector: [0, 90, 0]
   - "tilt forward 45" -> vector: [45, 0, 0]

4. 'scale' (Resizing):
   - params: { vector: [x, y, z], id: 'selected' or object_id }
   - 'vector' represents MULTIPLIERS. 1.0 = no change.
   - "scale by half" or "50%" -> vector: [0.5, 0.5, 0.5]
   - "double size" -> vector: [2, 2, 2]
   - "scale X by 3" -> vector: [3, 1, 1]
   - "make it 1.5 times bigger" -> vector: [1.5, 1.5, 1.5]

5. 'color':
   - params: { color: hex_string, id: 'selected' or object_id }
   - Convert color names to Hex (e.g., "red" -> "#ff0000").

6. 'delete' / 'clear':
   - 'delete': remove specific object. params: { id: string }
   - 'clear': remove all objects.

General Rules:
- Context: Use the provided "Scene Objects" list to resolve vague references like "the red box" to specific IDs.
- If no specific object is referenced, apply to id: "selected".
- Return ONLY JSON.
`;

const projectKnowledgeBase = `
PROJECT DOCUMENTATION: GESTURE FLOW 3D

1. OVERVIEW
Gesture Flow 3D is a futuristic, hands-free 3D modeling application that runs entirely in the browser. It uses computer vision to track hand movements and map them to 3D interactions, allowing users to create, move, rotate, and scale objects without touching a mouse or keyboard.

2. TECH STACK
- Frontend Framework: React 18 with TypeScript.
- 3D Engine: Three.js via React Three Fiber (@react-three/fiber) and Drei helpers.
- Computer Vision: Google MediaPipe Hands (via @mediapipe/tasks-vision) for high-performance, real-time hand landmark detection in the browser.
- AI & NLP: Google Gemini 2.5 Flash API for interpreting natural language commands and explaining the project.
- Styling: Tailwind CSS for a modern, glassmorphic UI.
- Build Tool: Vite (implied by module usage).

3. ARCHITECTURE & WORKFLOW
A. Hand Tracking (HandTracker.tsx):
   - Uses MediaPipe to detect 21 landmarks on the user's hand from the webcam feed.
   - Runs a custom heuristic algorithm to classify gestures based on finger extension and distances.
   - Outputs normalized coordinates (x, y) and gesture state to the main app loop.

B. Gesture System (Logic in HandTracker.tsx & App.tsx):
   - POINTING (Index extended): Moves the 3D cursor.
   - PINCH (Thumb + Index touching): The primary "Click" or "Grab" action. Used to select objects, drag them, or click buttons.
   - FIST (All fingers curled): Camera control. Rotating the fist rotates the camera orbit.
   - VICTORY (Peace sign): Holding this gesture opens the "Creation Menu" to add new shapes.
   - DELETE (Rock/Horns - Index + Pinky): Holding this gesture deletes the currently selected object.
   - OPEN PALM SWIPE UP: Rapidly moving an open hand upward triggers the "Radial Menu" for tool selection.

C. 3D Interaction (Scene3D.tsx):
   - Uses a custom 'InteractionManager' component inside the Canvas.
   - Implements a Raycaster mapped to the hand's x/y coordinates.
   - When a "Pinch" is detected, it locks onto the intersected object (if any) and enters a specific transform mode (Move, Rotate, Scale, Color).
   - "Ghost" objects are used during placement to visualize where a new shape will appear.

D. AI Integration:
   - The 'geminiService.ts' file handles communication with Google's GenAI SDK.
   - It acts as an "Expert" to answer questions about the code or as a "Commander" to execute actions like "make a red sphere".

4. KEY FILES
- App.tsx: Main state manager, UI overlay, and gesture event loop.
- Scene3D.tsx: The Three.js canvas containing lights, grid, objects, and interaction logic.
- HandTracker.tsx: Wraps the webcam and MediaPipe logic.
- types.ts: TypeScript definitions for AppMode, GestureType, etc.

5. UNIQUE FEATURES
- Radial Menu: A 4-quadrant menu (Move, Rotate, Scale, Color) accessed by swiping up, designed specifically for cursor-less interaction.
- Dynamic Sensitivity: User-adjustable sensitivity for gesture inputs.
- Hybrid Control: Supports both direct hand manipulation and AI natural language commands.
`;

export const interpretCommand = async (prompt: string): Promise<AIGeneratedCommand | null> => {
  if (!apiKey) {
    console.warn("Gemini API Key missing");
    return null;
  }

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING, enum: ['create', 'delete', 'color', 'clear', 'move', 'rotate', 'scale'] },
            params: { 
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                position: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                color: { type: Type.STRING },
                id: { type: Type.STRING },
                vector: { type: Type.ARRAY, items: { type: Type.NUMBER } }
              }
            },
            reasoning: { type: Type.STRING }
          }
        }
      }
    });

    const text = response.text;
    if (!text) return null;
    
    return JSON.parse(text) as AIGeneratedCommand;
  } catch (error) {
    console.error("Gemini interpretation failed:", error);
    return null;
  }
};

export const askProjectQuestion = async (question: string): Promise<string> => {
  if (!apiKey) return "API Key is missing. Cannot consult AI.";
  
  try {
     const response = await ai.models.generateContent({
        model: modelName,
        contents: question,
        config: {
           systemInstruction: `You are the lead developer and documentation expert for the "Gesture Flow 3D" project. 
           Use the following technical documentation to answer the user's question clearly, concisely, and accurately.
           If the user asks about the tech stack, explain React, Three.js, MediaPipe, and Gemini.
           If the user asks how it works, explain the pipeline from Webcam -> MediaPipe -> React State -> Three.js updates.
           
           ${projectKnowledgeBase}
           `,
        }
     });
     return response.text || "I couldn't generate an answer.";
  } catch (err) {
     console.error("AI QA Failed", err);
     return "Sorry, I encountered an error trying to answer that.";
  }
}