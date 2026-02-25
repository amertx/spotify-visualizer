import * as THREE from 'three';

interface Ring {
  mesh:   THREE.Mesh;
  mat:    THREE.MeshBasicMaterial;
  age:    number;
  life:   number;   // total lifetime in seconds
  active: boolean;
}

const POOL_SIZE = 16;

export class BeatRings {
  group: THREE.Group;
  private pool: Ring[] = [];

  constructor() {
    this.group = new THREE.Group();

    for (let i = 0; i < POOL_SIZE; i++) {
      // Thin flat ring — visible from any angle once we randomise orientation
      const geo = new THREE.TorusGeometry(1, 0.012, 6, 80);
      const mat = new THREE.MeshBasicMaterial({
        color:       0xffffff,
        transparent: true,
        opacity:     0,
        depthWrite:  false,
        side:        THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      this.group.add(mesh);
      this.pool.push({ mesh, mat, age: 0, life: 1.0, active: false });
    }
  }

  // Emit a ring in a random orientation around the blob
  emit(hue: number, confidence: number) {
    const ring = this.pool.find((r) => !r.active);
    if (!ring) return;

    ring.active = true;
    ring.age    = 0;
    ring.life   = 0.55 + confidence * 0.45; // confident beats get longer rings

    ring.mat.color.setHSL(hue, 1.0, 0.65);
    ring.mat.opacity = 0.9;

    // Random orientation so rings come out in all directions
    ring.mesh.rotation.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
    );
    ring.mesh.scale.setScalar(0.3); // start small, at blob surface
  }

  // Call once per frame; dt = elapsed seconds since last frame
  update(dt: number) {
    for (const ring of this.pool) {
      if (!ring.active) continue;

      ring.age += dt;
      const t = ring.age / ring.life; // 0→1

      if (t >= 1) {
        ring.active    = false;
        ring.mat.opacity = 0;
        continue;
      }

      // Expand from ~radius 0.3 to ~radius 7
      ring.mesh.scale.setScalar(0.3 + t * 6.5);

      // Fade: linear out — crisp at start, gone at end
      ring.mat.opacity = (1 - t) * (1 - t) * 0.85;
    }
  }

  dispose() {
    for (const r of this.pool) {
      r.mesh.geometry.dispose();
      r.mat.dispose();
    }
  }
}
