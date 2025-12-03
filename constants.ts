import { SceneObject } from './types';

export const CAMERA_FOV = 50;
export const PINCH_THRESHOLD = 0.05; // Distance between thumb and index tip
export const MOVEMENT_SPEED = 0.1;
export const ROTATION_SPEED = 0.05;

// Initial scene objects
export const INITIAL_OBJECTS: SceneObject[] = [
  {
    id: 'cube-1',
    type: 'box',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: '#6366f1'
  }
];