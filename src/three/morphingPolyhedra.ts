import * as THREE from 'three';
import { blobVertexShader, blobFragmentShader, blobWireFragmentShader } from './shaders/blob';
import type { AudioFeatures } from '../spotify/types';

export interface BlobUniforms {
  [key: string]:    { value: number };
  uTime:            { value: number };
  uBeat:            { value: number };
  uEnergy:          { value: number };
  uHue1:            { value: number };  // primary hue   — top pitch class
  uHue2:            { value: number };  // secondary hue — 2nd pitch class
  uHue3:            { value: number };  // accent hue    — 3rd pitch class / peaks
  uDanceability:    { value: number };
  uAcousticness:    { value: number };
  uRoughness:       { value: number };  // ZCR-derived: 0=smooth pads, 1=noisy/percussive
}

export class MorphingPolyhedra {
  group: THREE.Group;

  // Shared uniforms — one object, both materials reference it
  uniforms: BlobUniforms;

  private solidMesh: THREE.Mesh;
  private wireMesh:  THREE.Mesh;
  private innerMesh: THREE.Mesh;

  // Beat envelope
  private beatLevel    = 0;
  private barFlash     = 0;
  private sectionBurst = 0;

  constructor() {
    this.group = new THREE.Group();

    this.uniforms = {
      uTime:         { value: 0 },
      uBeat:         { value: 0 },
      uEnergy:       { value: 0.55 },
      uHue1:         { value: 0.72 },  // default violet
      uHue2:         { value: 0.50 },  // default teal
      uHue3:         { value: 0.10 },  // default amber
      uDanceability: { value: 0.55 },
      uAcousticness: { value: 0.45 },
      uRoughness:    { value: 0.0  },
    };

    // IcosahedronGeometry detail=5 → 5120 faces
    const geo = new THREE.IcosahedronGeometry(2, 5);

    const solidMat = new THREE.ShaderMaterial({
      uniforms:       this.uniforms,
      vertexShader:   blobVertexShader,
      fragmentShader: blobFragmentShader,
      transparent: true,
      side:        THREE.DoubleSide,
      depthWrite:  false,
    });
    this.solidMesh = new THREE.Mesh(geo, solidMat);

    const wireMat = new THREE.ShaderMaterial({
      uniforms:       this.uniforms,
      vertexShader:   blobVertexShader,
      fragmentShader: blobWireFragmentShader,
      wireframe:   true,
      transparent: true,
      depthWrite:  false,
    });
    this.wireMesh = new THREE.Mesh(geo, wireMat);

    // Inner glowing nucleus — larger and brighter for presence
    const innerGeo = new THREE.IcosahedronGeometry(0.65, 2);
    const innerMat = new THREE.MeshPhongMaterial({
      color:             0xffffff,
      emissive:          new THREE.Color().setHSL(0.72, 1.0, 0.65),
      emissiveIntensity: 3.5,
      transparent:       true,
      opacity:           0.22,
      depthWrite:        false,
    });
    this.innerMesh = new THREE.Mesh(innerGeo, innerMat);

    this.group.add(this.solidMesh, this.wireMesh, this.innerMesh);
  }

  // ── External triggers ─────────────────────────────────────────────────────

  triggerBeat(confidence: number) {
    this.beatLevel = Math.max(this.beatLevel, confidence);
  }

  triggerBar() {
    this.barFlash = 1.0;
  }

  triggerSection(loudness: number, _mode: number) {
    const loud = Math.min(1, (loudness + 60) / 60);
    this.sectionBurst = 0.6 + loud * 0.4;
  }

  // ── Per-frame update ──────────────────────────────────────────────────────

  update(time: number, f?: AudioFeatures) {
    const energy       = f?.energy       ?? 0.5;
    const danceability = f?.danceability ?? 0.5;
    const acousticness = f?.acousticness ?? 0.5;
    const tempo        = f?.tempo        ?? 120;

    this.beatLevel    *= 0.78;
    this.barFlash     *= 0.84;
    this.sectionBurst *= 0.88;

    this.uniforms.uTime.value         = time;
    this.uniforms.uBeat.value         = this.beatLevel + this.barFlash * 0.4 + this.sectionBurst * 0.3;
    this.uniforms.uEnergy.value       = energy;
    this.uniforms.uDanceability.value = danceability;
    this.uniforms.uAcousticness.value = acousticness;
    // uHue1/2/3 are set externally by scene.ts (smooth hue tracking)

    // Inner nucleus color tracks uHue1 (primary hue)
    const innerMat = this.innerMesh.material as THREE.MeshPhongMaterial;
    innerMat.emissive.setHSL(this.uniforms.uHue1.value, 1.0, 0.6);
    innerMat.emissiveIntensity = 1.5 + this.beatLevel * 5.0 + this.barFlash * 3.0 + this.sectionBurst * 4.0;
    innerMat.opacity           = 0.12 + this.beatLevel * 0.4 + this.barFlash * 0.15;

    // Rotation driven by tempo + beat micro-burst
    const rotBase  = (tempo / 120) * 0.004;
    const rotBurst = this.beatLevel * 0.012 + this.sectionBurst * 0.006;
    this.group.rotation.y += rotBase + rotBurst;
    this.group.rotation.x += (rotBase + rotBurst) * 0.40;
    this.group.rotation.z += rotBase * 0.22;

    // Scale pulse on beat
    const scale = 1.0 + this.beatLevel * 0.10 + this.barFlash * 0.04 + this.sectionBurst * 0.08;
    this.group.scale.setScalar(scale);
  }

  dispose() {
    (this.solidMesh.geometry as THREE.BufferGeometry).dispose();
    (this.innerMesh.geometry as THREE.BufferGeometry).dispose();
    (this.solidMesh.material as THREE.Material).dispose();
    (this.wireMesh.material  as THREE.Material).dispose();
    (this.innerMesh.material as THREE.Material).dispose();
  }
}
