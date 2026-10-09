/* Task 005 / M5.1 — analytical WebGL2 particle prototype.
 * Fixed geometry is generated once. The vertex shader evaluates each particle
 * from immutable spawn data and a single global time uniform.
 * No per-particle CPU update, Node, readback or physics-world contact.
 */
import { _decorator, CCInteger, CCFloat, Vec3, Vec4, warn } from '../core';
import { Material } from '../asset/assets/material';
import { Mesh } from '../3d/assets/mesh';
import { Component } from '../scene-graph/component';
import { MeshRenderer } from '../3d/framework/mesh-renderer';
import { createMesh } from '../3d/misc/create-mesh';
import { deviceManager, API } from '../gfx';

const { ccclass, menu, property, type } = _decorator;

function xorshift32 (value: number): number {
    let x = value | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return x | 0;
}

@ccclass('cc.GPUParticleSystem')
@menu('Effects/GPU Particle System (Experimental)')
export class GPUParticleSystem extends Component {
    @property({ type: CCInteger, range: [1, 20000, 1] })
    public capacity = 10000;

    @property({ type: CCInteger })
    public seed = 1337;

    @property({ type: CCFloat })
    public lifetime = 3;

    @property({ type: CCFloat })
    public speed = 2;

    @property({ type: CCFloat })
    public size = 0.05;

    @property({ type: Vec3 })
    public spawnExtent = new Vec3(2, 1, 2);

    @property({ type: Vec3 })
    public gravity = new Vec3(0, -9.8, 0);

    @property({ type: CCFloat })
    public drag = 0;

    @property({ type: Material })
    public particleMaterial: Material | null = null;

    private _mesh: Mesh | null = null;
    private _renderer: MeshRenderer | null = null;
    private _time = 0;

    protected onLoad (): void {
        // Intentional: WebGL1 is outside the scope of Task 005 v0.1.
        if (deviceManager.gfxDevice.api !== API.WEBGL2) {
            warn('GPUParticleSystem requires WebGL2; emitter disabled.');
            this.enabled = false;
            return;
        }
        if (!this.particleMaterial) {
            warn('GPUParticleSystem requires the Task 005 GPU particle material.');
            this.enabled = false;
            return;
        }
        this._renderer = this.getComponent(MeshRenderer) || this.addComponent(MeshRenderer);
        this._mesh = this._buildMesh();
        this._renderer.mesh = this._mesh;
        this._renderer.setMaterial(this.particleMaterial, 0);
        this._syncMaterial();
    }

    protected update (dt: number): void {
        this._time += Math.max(0, dt);
        const mat = this._renderer?.getMaterialInstance(0);
        if (mat) mat.setProperty('u_simParams', new Vec4(this._time, Math.max(0.001, this.lifetime), Math.max(0.001, this.size), Math.max(0, this.drag)));
    }

    protected onDestroy (): void {
        if (this._renderer && this._renderer.mesh === this._mesh) {
            this._renderer.mesh = null;
        }
        this._mesh?.destroy();
        this._mesh = null;
    }

    private _syncMaterial (): void {
        const mat = this._renderer?.getMaterialInstance(0);
        if (!mat) return;
        mat.setProperty('u_time', this._time);
        
        mat.setProperty('u_gravity', new Vec4(this.gravity.x, this.gravity.y, this.gravity.z, 0));
    }

    private _buildMesh (): Mesh {
        const count = Math.max(1, Math.min(20000, Math.floor(this.capacity)));
        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const tangents: number[] = [];
        const indices: number[] = [];
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        let rng = this.seed | 0 || 1;
        const random = (): number => {
            rng = xorshift32(rng);
            return (rng >>> 0) / 4294967296;
        };
        for (let i = 0; i < count; ++i) {
            const px = (random() - 0.5) * this.spawnExtent.x;
            const py = (random() - 0.5) * this.spawnExtent.y;
            const pz = (random() - 0.5) * this.spawnExtent.z;
            const angle = random() * Math.PI * 2;
            const h = random() * 2 - 1;
            const r = Math.sqrt(1 - h * h);
            const vx = Math.cos(angle) * r * this.speed;
            const vy = h * this.speed;
            const vz = Math.sin(angle) * r * this.speed;
            const phase = random(); // shared deterministic lifetime offset
            for (let c = 0; c < 4; ++c) {
                positions.push(px, py, pz);
                normals.push(vx, vy, vz);
                uvs.push(corners[c][0], corners[c][1]);
                tangents.push(phase, 0, 0, 0);
            }
            const j = i * 4;
            indices.push(j, j + 1, j + 2, j, j + 2, j + 3);
        }
        // The vertex shader displaces geometry beyond its immutable spawn bounds.
        // Use a conservative local-space envelope to avoid incorrect frustum culling.
        const life = Math.max(0.001, this.lifetime);
        const gravitationalTravel = 0.5 * Vec3.len(this.gravity) * life * life;
        const travel = Math.abs(this.speed) * life + gravitationalTravel + Math.abs(this.size);
        const ex = Math.abs(this.spawnExtent.x) * 0.5 + travel;
        const ey = Math.abs(this.spawnExtent.y) * 0.5 + travel;
        const ez = Math.abs(this.spawnExtent.z) * 0.5 + travel;
        return createMesh({
            positions, normals, uvs, tangents, indices,
            minPos: new Vec3(-ex, -ey, -ez),
            maxPos: new Vec3(ex, ey, ez),
        });
    }
}
