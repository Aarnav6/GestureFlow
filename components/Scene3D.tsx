
import React, { useRef, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, ContactShadows, TransformControls, Stats } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFExporter } from 'three-stdlib';
import { AppMode, GestureType, HandData, SceneObject, TransformMode } from '../types';

interface Scene3DProps {
  objects: SceneObject[];
  handData: HandData | null;
  mode: AppMode;
  selectedId: string | null;
  transformMode: TransformMode;
  sensitivity: number;
  onSelect: (id: string | null) => void;
  onUpdateObject: (id: string, updates: Partial<SceneObject>) => void;
  pendingObjectType: 'box' | 'sphere' | 'torus' | 'cone' | null;
  onPlaceObject: (position: [number, number, number]) => void;
  exportRequest: 'image' | 'gltf' | null;
  onExportComplete: () => void;
}

// Helper to handle export logic
const Exporter: React.FC<{ request: 'image' | 'gltf' | null, onComplete: () => void, objects: SceneObject[] }> = ({ request, onComplete, objects }) => {
  const { gl, scene } = useThree();

  useEffect(() => {
    if (!request) return;

    if (request === 'image') {
      // Image Export
      const image = gl.domElement.toDataURL('image/png');
      const link = document.createElement('a');
      link.setAttribute('download', 'gesture-flow-snapshot.png');
      link.setAttribute('href', image);
      link.click();
      onComplete();
    } 
    else if (request === 'gltf') {
      // GLTF Export
      const exporter = new GLTFExporter();
      // Filter out helpers and grid from export
      const exportScene = new THREE.Scene();
      
      scene.children.forEach(child => {
        // Only export the actual meshes created by user
        if (child.userData && child.userData.id) {
           exportScene.add(child.clone());
        }
      });

      exporter.parse(
        exportScene,
        (gltf) => {
          const output = JSON.stringify(gltf, null, 2);
          const blob = new Blob([output], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.style.display = 'none';
          link.href = url;
          link.download = 'gesture-flow-model.gltf';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          onComplete();
        },
        (error) => {
          console.error('An error happened during export:', error);
          onComplete();
        },
        { binary: false }
      );
    }

  }, [request, gl, scene, onComplete]);

  return null;
}

// Helper component to handle interactions within the Canvas context
const InteractionManager: React.FC<{
  handData: HandData | null;
  mode: AppMode;
  selectedId: string | null;
  transformMode: TransformMode;
  sensitivity: number;
  onUpdateObject: (id: string, updates: Partial<SceneObject>) => void;
  onSelect: (id: string | null) => void;
  pendingObjectType: string | null;
  onPlaceObject: (pos: [number, number, number]) => void;
}> = ({ handData, mode, selectedId, transformMode, sensitivity, onUpdateObject, onSelect, pendingObjectType, onPlaceObject }) => {
  const { camera, scene } = useThree();
  const [prevHandPos, setPrevHandPos] = useState<{x: number, y: number, gestureWasPinch: boolean} | null>(null);
  const [waitingForPinchRelease, setWaitingForPinchRelease] = useState(false);
  
  // Drag State Ref
  const dragRef = useRef({
    isDragging: false,
    targetId: null as string | null,
    distanceToCamera: 10,
    startCursorPos: new THREE.Vector3(),
    startObjPos: new THREE.Vector3(),
    startObjRot: new THREE.Euler(),
    startObjScale: new THREE.Vector3(),
    startColorHSL: { h: 0, s: 0, l: 0 }
  });

  const cursorRef = useRef<THREE.Mesh>(null);
  const ghostRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (mode === AppMode.PLACING) {
      setWaitingForPinchRelease(true);
    } else {
      setWaitingForPinchRelease(false);
    }
  }, [mode]);

  useFrame(() => {
    if (!handData || mode === AppMode.MENU || mode === AppMode.RADIAL || mode === AppMode.HUB || mode === AppMode.SETTINGS) {
      if (cursorRef.current) cursorRef.current.visible = false;
      if (ghostRef.current) ghostRef.current.visible = false;
      dragRef.current.isDragging = false; 
      return;
    }
    
    if (cursorRef.current) cursorRef.current.visible = true;

    // 1. Calculate Cursor Position
    const vector = new THREE.Vector3(handData.x, handData.y, 0.5);
    vector.unproject(camera);
    const dir = vector.sub(camera.position).normalize();
    
    const projectionDistance = dragRef.current.isDragging ? dragRef.current.distanceToCamera : 10;
    const cursorPos = camera.position.clone().add(dir.multiplyScalar(projectionDistance));
    
    // Update visual cursor mesh
    if (cursorRef.current) {
      cursorRef.current.position.lerp(cursorPos, 0.2);
      
      let scale = 0.2;
      let color = '#00ffcc';

      if (mode === AppMode.PLACING) {
        scale = 0.1;
        color = waitingForPinchRelease ? '#888888' : '#ffffff';
      } else if (dragRef.current.isDragging) {
        scale = 0.25;
        color = '#ffaa00'; 
      } else if (handData.isPinching) {
        scale = 0.15;
        color = '#ff0055';
      } else if (handData.gesture === GestureType.VICTORY) {
        scale = 0.3;
        color = '#ff0000';
      }

      cursorRef.current.scale.set(scale, scale, scale);
      if (cursorRef.current.material instanceof THREE.Material) {
        (cursorRef.current.material as any).color.set(color);
      }
    }

    // Update Ghost Object
    if (mode === AppMode.PLACING && ghostRef.current) {
      ghostRef.current.visible = true;
      ghostRef.current.position.lerp(cursorPos, 0.2);
      if (Math.abs(ghostRef.current.position.y) < 1) ghostRef.current.position.y = 0.5;
    } else if (ghostRef.current) {
      ghostRef.current.visible = false;
    }

    // 2. Logic: Pinch Release Wait
    if (waitingForPinchRelease) {
      if (!handData.isPinching) setWaitingForPinchRelease(false);
      setPrevHandPos({ x: handData.x, y: handData.y, gestureWasPinch: handData.isPinching });
      return;
    }

    // 3. Logic: Gesture Interaction
    const isPinching = handData.isPinching;
    const wasPinching = prevHandPos?.gestureWasPinch || false;

    // --- CASE A: START PINCH (Click / Grab) ---
    if (isPinching && !wasPinching) {
      if (mode === AppMode.PLACING && ghostRef.current) {
        const p = ghostRef.current.position;
        onPlaceObject([p.x, p.y, p.z]);
      } 
      else if (mode === AppMode.EDIT || mode === AppMode.VIEW) {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(handData.x, handData.y), camera);
        
        const intersects = raycaster.intersectObjects(scene.children, true).filter(i => 
          i.object.uuid !== cursorRef.current?.uuid &&
          i.object.parent?.uuid !== ghostRef.current?.uuid &&
          i.object.type === "Mesh" && 
          i.object.name !== "helper"
        );

        if (intersects.length > 0) {
          const hit = intersects[0];
          const objectId = hit.object.name || hit.object.parent?.name;
          
          if (objectId) {
            onSelect(objectId);
            
            dragRef.current.isDragging = true;
            dragRef.current.targetId = objectId;
            dragRef.current.distanceToCamera = hit.distance;
            dragRef.current.startCursorPos.copy(cursorPos);
            
            const obj = scene.getObjectByName(objectId);
            if (obj) {
               dragRef.current.startObjPos.copy(obj.position);
               dragRef.current.startObjRot.copy(obj.rotation);
               dragRef.current.startObjScale.copy(obj.scale);
               
               if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
                  const c = obj.material.color.clone();
                  const hsl = { h: 0, s: 0, l: 0 };
                  c.getHSL(hsl);
                  dragRef.current.startColorHSL = hsl;
               }
            }
          }
        }
      }
    }

    // --- CASE B: DRAGGING ---
    if (isPinching && dragRef.current.isDragging && dragRef.current.targetId) {
       const obj = scene.getObjectByName(dragRef.current.targetId);
       
       if (obj) {
         const delta = cursorPos.clone().sub(dragRef.current.startCursorPos);
         
         if (transformMode === 'translate') {
            obj.position.copy(dragRef.current.startObjPos).add(delta);
         } 
         else if (transformMode === 'rotate') {
            const rotSpeed = 2.0 * sensitivity;
            obj.rotation.x = dragRef.current.startObjRot.x + (delta.y * rotSpeed);
            obj.rotation.y = dragRef.current.startObjRot.y + (delta.x * rotSpeed);
         } 
         else if (transformMode === 'scale') {
            const scaleSpeed = 1.0 * sensitivity;
            const factor = 1 + (delta.y * scaleSpeed);
            const safeFactor = Math.max(0.1, factor);
            obj.scale.copy(dragRef.current.startObjScale).multiplyScalar(safeFactor);
         }
         else if (transformMode === 'color') {
             if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
                const hsl = { ...dragRef.current.startColorHSL };
                hsl.h = (hsl.h + (delta.x * 0.5 * sensitivity)) % 1;
                if (hsl.h < 0) hsl.h += 1;
                obj.material.color.setHSL(hsl.h, hsl.s, hsl.l);
             }
         }
       }
    }

    // --- CASE C: END PINCH ---
    if (!isPinching && wasPinching && dragRef.current.isDragging) {
       const obj = scene.getObjectByName(dragRef.current.targetId || '');
       if (obj && dragRef.current.targetId) {
          if (transformMode === 'color' && obj instanceof THREE.Mesh) {
             const mat = obj.material as THREE.MeshStandardMaterial;
             onUpdateObject(dragRef.current.targetId, { color: '#' + mat.color.getHexString() });
          } else {
             onUpdateObject(dragRef.current.targetId, {
                position: [obj.position.x, obj.position.y, obj.position.z],
                rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
                scale: [obj.scale.x, obj.scale.y, obj.scale.z]
             });
          }
       }
       dragRef.current.isDragging = false;
       dragRef.current.targetId = null;
    }

    setPrevHandPos({ x: handData.x, y: handData.y, gestureWasPinch: handData.isPinching });
  });

  return (
    <>
      <mesh ref={cursorRef} position={[0, 0, 0]}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color="#00ffcc" transparent opacity={0.6} depthTest={false} />
      </mesh>

      <group ref={ghostRef} visible={false}>
         {pendingObjectType === 'box' && <mesh><boxGeometry /><meshBasicMaterial color="#00ff00" wireframe /></mesh>}
         {pendingObjectType === 'sphere' && <mesh><sphereGeometry /><meshBasicMaterial color="#00ff00" wireframe /></mesh>}
         {pendingObjectType === 'torus' && <mesh><torusGeometry args={[0.7, 0.3, 16, 32]} /><meshBasicMaterial color="#00ff00" wireframe /></mesh>}
         {pendingObjectType === 'cone' && <mesh><coneGeometry /><meshBasicMaterial color="#00ff00" wireframe /></mesh>}
      </group>
    </>
  );
};

const CameraController: React.FC<{ handData: HandData | null, mode: AppMode, sensitivity: number }> = ({ handData, mode, sensitivity }) => {
  const { controls, camera } = useThree();
  
  useFrame((state, delta) => {
    if (!controls) return;
    const orbit = controls as any;
    const g = handData?.gesture;
    
    // 1. ZOOM: Thumbs Up / Thumbs Down
    if ((g === GestureType.THUMBS_UP || g === GestureType.THUMB_DOWN) && (mode === AppMode.VIEW || mode === AppMode.EDIT)) {
        orbit.enableRotate = false;
        orbit.enablePan = false;
        orbit.enableZoom = false;

        const zoomSpeed = 5 * sensitivity * delta; 
        const vec = new THREE.Vector3();
        camera.getWorldDirection(vec); // Forward direction
        
        // Thumbs UP = Zoom IN (Forward)
        // Thumbs DOWN = Zoom OUT (Backward)
        const dir = g === GestureType.THUMBS_UP ? 1 : -1;
        
        camera.position.addScaledVector(vec, dir * zoomSpeed);
    } else {
       orbit.enableRotate = true;
       orbit.enableZoom = true;
       if (mode === AppMode.VIEW || mode === AppMode.EDIT) {
          orbit.enablePan = false; 
       }
    }
  });

  return null;
}

const Scene3D: React.FC<Scene3DProps> = ({ objects, handData, mode, selectedId, transformMode, sensitivity, onSelect, onUpdateObject, pendingObjectType, onPlaceObject, exportRequest, onExportComplete }) => {
  return (
    <Canvas 
      shadows 
      camera={{ position: [5, 5, 5], fov: 50 }}
      dpr={[1, 1.5]}
      gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
    >
      <Stats className="!absolute !top-[80px] !left-5" />

      <group>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
        <spotLight position={[-10, 10, 5]} angle={0.3} penumbra={1} intensity={2} castShadow />
      </group>

      <InteractionManager 
        handData={handData} 
        mode={mode} 
        selectedId={selectedId}
        transformMode={transformMode}
        sensitivity={sensitivity}
        onUpdateObject={onUpdateObject}
        onSelect={onSelect}
        pendingObjectType={pendingObjectType}
        onPlaceObject={onPlaceObject}
      />
      
      <CameraController handData={handData} mode={mode} sensitivity={sensitivity} />
      
      <Exporter request={exportRequest} onComplete={onExportComplete} objects={objects} />

      <Grid infiniteGrid fadeDistance={50} sectionColor="#4f4f4f" cellColor="#333" />

      <group>
        {objects.map((obj) => (
          <group key={obj.id} position={new THREE.Vector3(...obj.position)} rotation={new THREE.Euler(...obj.rotation)} scale={new THREE.Vector3(...obj.scale)}>
             <mesh 
                name={obj.id}
                userData={{ id: obj.id }}
                onClick={(e) => { e.stopPropagation(); onSelect(obj.id); }}
                castShadow 
                receiveShadow
              >
               {obj.type === 'box' && <boxGeometry />}
               {obj.type === 'sphere' && <sphereGeometry />}
               {obj.type === 'torus' && <torusGeometry args={[0.7, 0.3, 16, 32]} />}
               {obj.type === 'cone' && <coneGeometry />}
               <meshStandardMaterial 
                  color={selectedId === obj.id ? '#ff0055' : obj.color} 
                  roughness={0.1} 
                  metalness={0.6} 
               />
             </mesh>
             
             {selectedId === obj.id && mode === AppMode.EDIT && transformMode !== 'color' && (
               <TransformControls 
                 object={undefined} 
                 mode={transformMode} 
                 onObjectChange={(e: any) => {
                    if (e?.target?.object) {
                       const o = e.target.object;
                       onUpdateObject(obj.id, {
                         position: [o.position.x, o.position.y, o.position.z],
                         rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
                         scale: [o.scale.x, o.scale.y, o.scale.z]
                       });
                    }
                 }}
               />
             )}
          </group>
        ))}
      </group>

      <ContactShadows position={[0, 0, 0]} opacity={0.4} scale={20} blur={2} far={4} resolution={256} frames={1} />
      
      <OrbitControls makeDefault />
    </Canvas>
  );
};

export default Scene3D;
