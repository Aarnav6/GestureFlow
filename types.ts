
export enum AppMode {
  VIEW = 'VIEW',
  EDIT = 'EDIT',
  CREATE = 'CREATE', // Used for AI Command context mostly
  MENU = 'MENU',      // The 2D Overlay Menu
  PLACING = 'PLACING', // Positioning a new object before commit
  RADIAL = 'RADIAL',   // The Radio Wheel Menu
  HUB = 'HUB',         // The Combined Help & AI Info Hub
  SETTINGS = 'SETTINGS' // The Control Panel & Export Menu
}

export enum GestureType {
  NONE = 'NONE',
  POINTING = 'POINTING',
  PINCH = 'PINCH',
  VICTORY = 'VICTORY', // Index + Middle (Create Menu)
  ROCK = 'ROCK',       // Index + Pinky (Control Panel)
  THUMBS_UP = 'THUMBS_UP',   // Zoom In
  THUMB_DOWN = 'THUMB_DOWN', // Zoom Out
  THREE_FINGERS = 'THREE_FINGERS', // Radial Menu
  SHAKA = 'SHAKA' // Thumb + Pinky (Cancel)
}

export type TransformMode = 'translate' | 'rotate' | 'scale' | 'color';

export interface HandData {
  x: number; // Normalized -1 to 1 (NDC for 3D)
  y: number; // Normalized -1 to 1 (NDC for 3D)
  gesture: GestureType;
  pinchDistance: number;
  isPinching: boolean;
}

export interface SceneObject {
  id: string;
  type: 'box' | 'sphere' | 'torus' | 'cone';
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
}

export interface AIGeneratedCommand {
  action: 'create' | 'delete' | 'color' | 'clear' | 'move' | 'rotate' | 'scale';
  params?: {
    type?: 'box' | 'sphere' | 'torus' | 'cone';
    position?: [number, number, number];
    color?: string;
    id?: string;
    vector?: [number, number, number]; // [x, y, z] used for move delta, rotate delta (degrees), or scale factor
  };
  reasoning?: string;
}