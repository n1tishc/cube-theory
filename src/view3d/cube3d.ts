import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { generateStickers, layerCoordinate, type Vec3 } from '../core/geometry';
import type { Move } from '../core/moves';
import type { TimelineController, TimelineSnapshot } from '../timeline/controller';

const COLORS = [0xf6f2df, 0xcb2d2a, 0x2f9b62, 0xf4d33f, 0xe77728, 0x1268bf];

function positionKey(position: Vec3): string {
  return position.join(',');
}

function ease(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function roundedStickerGeometry(size: number, radius: number): THREE.ShapeGeometry {
  const half = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-half + radius, -half);
  shape.lineTo(half - radius, -half);
  shape.quadraticCurveTo(half, -half, half, -half + radius);
  shape.lineTo(half, half - radius);
  shape.quadraticCurveTo(half, half, half - radius, half);
  shape.lineTo(-half + radius, half);
  shape.quadraticCurveTo(-half, half, -half, half - radius);
  shape.lineTo(-half, -half + radius);
  shape.quadraticCurveTo(-half, -half, -half + radius, -half);
  return new THREE.ShapeGeometry(shape);
}

export class Cube3DView {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private root = new THREE.Group();
  private pivot: THREE.Group | null = null;
  private cubies: THREE.Group[] = [];
  private size = 0;
  private renderedState: Uint8Array | null = null;
  private activeReference: TimelineSnapshot['active'] = null;

  constructor(container: HTMLElement, controller: TimelineController) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D cube');
    this.renderer.domElement.setAttribute('role', 'img');
    container.append(this.renderer.domElement);

    this.camera.position.set(6.7, 5.8, 7.6);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 18;

    this.scene.add(new THREE.HemisphereLight(0xfffbed, 0x44413c, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(5, 8, 6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xb8d5ff, 1.2);
    fill.position.set(-5, 2, 4);
    this.scene.add(fill);
    this.scene.add(this.root);

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      this.renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      this.camera.aspect = Math.max(1, width) / Math.max(1, height);
      this.camera.updateProjectionMatrix();
      if (this.size > 0) this.fitCamera(this.size, true);
    };
    new ResizeObserver(resize).observe(container);
    resize();

    controller.subscribe((snapshot) => this.update(snapshot));
    const render = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(render);
    };
    render();
  }

  private update(snapshot: TimelineSnapshot): void {
    const active = snapshot.active;
    if (snapshot.size !== this.size) {
      this.rebuild(snapshot.size, active?.before ?? snapshot.state);
      this.activeReference = null;
    }

    if (active) {
      if (active !== this.activeReference) {
        this.rebuild(snapshot.size, active.before);
        this.prepareMove(active.move, snapshot.size);
        this.activeReference = active;
      }
      if (this.pivot) {
        const signedTurns = active.move.turns === 3 ? -1 : active.move.turns;
        const angle = -signedTurns * Math.PI * 0.5 * ease(active.progress);
        this.pivot.rotation.set(
          active.move.axis === 0 ? angle : 0,
          active.move.axis === 1 ? angle : 0,
          active.move.axis === 2 ? angle : 0,
        );
      }
      return;
    }

    if (this.activeReference || snapshot.state !== this.renderedState) {
      this.rebuild(snapshot.size, snapshot.state);
      this.activeReference = null;
    }
  }

  private rebuild(size: number, state: Uint8Array): void {
    this.scene.remove(this.root);
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.pivot = null;
    this.cubies = [];
    this.size = size;
    this.renderedState = state;

    const cubieByPosition = new Map<string, THREE.Group>();
    const extent = size - 1;
    for (let x = 0; x < size; x += 1) {
      for (let y = 0; y < size; y += 1) {
        for (let z = 0; z < size; z += 1) {
          const surface = x === 0 || y === 0 || z === 0 || x === size - 1 || y === size - 1 || z === size - 1;
          if (!surface) continue;
          const coordinates: Vec3 = [-extent + x * 2, -extent + y * 2, -extent + z * 2];
          const cubie = new THREE.Group();
          cubie.position.set(coordinates[0] / 2, coordinates[1] / 2, coordinates[2] / 2);
          cubie.userData.coordinates = coordinates;
          const body = new THREE.Mesh(
            new THREE.BoxGeometry(0.94, 0.94, 0.94),
            new THREE.MeshStandardMaterial({ color: 0x17191a, roughness: 0.72, metalness: 0.04 }),
          );
          cubie.add(body);
          this.root.add(cubie);
          this.cubies.push(cubie);
          cubieByPosition.set(positionKey(coordinates), cubie);
        }
      }
    }

    const stickerGeometry = roundedStickerGeometry(0.78, 0.085);
    generateStickers(size).forEach((sticker) => {
      const cubie = cubieByPosition.get(positionKey(sticker.pos));
      if (!cubie) return;
      const material = new THREE.MeshStandardMaterial({
        color: COLORS[state[sticker.index] ?? 0],
        roughness: 0.58,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      const plane = new THREE.Mesh(stickerGeometry.clone(), material);
      const [nx, ny, nz] = sticker.normal;
      plane.position.set(nx * 0.481, ny * 0.481, nz * 0.481);
      if (nx === 1) plane.rotation.y = Math.PI / 2;
      if (nx === -1) plane.rotation.y = -Math.PI / 2;
      if (ny === 1) plane.rotation.x = -Math.PI / 2;
      if (ny === -1) plane.rotation.x = Math.PI / 2;
      if (nz === -1) plane.rotation.y = Math.PI;
      cubie.add(plane);
    });

    this.controls.target.set(0, 0, 0);
    this.fitCamera(size);
  }

  private fitCamera(size: number, preserveDirection = false): void {
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    const limitingHalfFov = Math.min(verticalFov, horizontalFov) / 2;
    const boundingRadius = Math.sqrt(3) * size * 0.5;
    const distance = Math.max(7, (boundingRadius / Math.sin(limitingHalfFov)) * 1.12);
    const direction = preserveDirection
      ? this.camera.position.clone().sub(this.controls.target).normalize()
      : new THREE.Vector3(0.78, 0.68, 0.9).normalize();

    this.controls.minDistance = Math.max(4, distance * 0.38);
    this.controls.maxDistance = Math.max(18, distance * 1.6);
    this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private prepareMove(move: Move, size: number): void {
    const coordinate = layerCoordinate(size, move.layer);
    const pivot = new THREE.Group();
    this.root.add(pivot);
    this.cubies.forEach((cubie) => {
      const coordinates = cubie.userData.coordinates as Vec3;
      if (coordinates[move.axis] === coordinate) pivot.attach(cubie);
    });
    this.pivot = pivot;
  }
}
