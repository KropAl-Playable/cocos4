/*
 Copyright (c) 2017-2023 Xiamen Yaji Software Co., Ltd.

 https://www.cocos.com/
*/

import { Color, Mat4, Vec3, Vec4, _decorator, CCBoolean, CCFloat, CCInteger, cclegacy } from '../../core';
import { Component } from '../../scene-graph';
import { Mesh } from '../assets/mesh';
import { MeshRenderer } from './mesh-renderer';
import { createCageInfluenceMesh, MAX_CAGE_CONTROLS, stepCageSpring } from '../misc/cage-deform';

const { ccclass, executeInEditMode, menu, property, requireComponent, range, type } = _decorator;

const _inverseWorld = new Mat4();
const _localDirection = new Vec3();
const _worldControl = new Vec3();
const _localPoint = new Vec3();

const MESH_CACHE = new WeakMap<Mesh, Map<number, Mesh>>();

function getCageMesh(source: Mesh, controlCount: number): Mesh {
    let variants = MESH_CACHE.get(source);
    if (!variants) {
        variants = new Map<number, Mesh>();
        MESH_CACHE.set(source, variants);
    }
    const count = Math.max(2, Math.min(MAX_CAGE_CONTROLS, Math.floor(controlCount)));
    let mesh = variants.get(count);
    if (!mesh || !mesh.isValid) {
        mesh = createCageInfluenceMesh(source, count);
        variants.set(count, mesh);
    }
    return mesh;
}

/**
 * Lightweight GPU cage deformation prototype for vegetation.
 *
 * v0.1 uses a compact vertical control chain and two influences per vertex.
 * CPU work is limited to a handful of spring controls; vertices are deformed
 * exclusively in the vertex shader.
 */
@ccclass('cc.CageDeformer')
@menu('Mesh/CageDeformer')
@executeInEditMode
@requireComponent(MeshRenderer)
export class CageDeformer extends Component {
    @property({ type: CCInteger })
    @range([2, MAX_CAGE_CONTROLS, 1])
    public controlCount = 6;

    @property({ type: CCFloat })
    @range([0, 5, 0.01])
    public windStrength = 0.35;

    @property({ type: CCFloat })
    @range([0, 5, 0.01])
    public windFrequency = 0.8;

    @property({ type: CCFloat })
    @range([0, 100, 0.1])
    public stiffness = 18;

    @property({ type: CCFloat })
    @range([0, 1, 0.001])
    public damping = 0.9;

    @property({ type: CCFloat })
    @range([0, 10, 0.01])
    public maxDisplacement = 1.5;

    @property({ type: CCFloat })
    @range([0, 1, 0.001])
    public flutterStrength = 0.02;

    @property({ type: CCFloat })
    @range([0, 20, 0.01])
    public flutterFrequency = 5;

    @property({ type: CCBoolean })
    public debugDraw = false;

    private _renderer: MeshRenderer | null = null;
    private _sourceMesh: Mesh | null = null;
    private _cageMesh: Mesh | null = null;
    private _controlCount = 0;
    private _time = 0;
    private _offsets: Vec3[] = [];
    private _velocities: Vec3[] = [];
    private _targets: Vec3[] = [];
    private _restControls: Vec3[] = [];
    private _uniformOffsets: Vec4[] = [];
    private _materialInstances: ReturnType<MeshRenderer['getMaterialInstance']>[] = [];

    protected onEnable(): void {
        this._renderer = this.getComponent(MeshRenderer);
        if (!this._renderer?.mesh) return;
        this._sourceMesh = this._renderer.mesh;
        this._rebuild();
    }

    protected onDisable(): void {
        if (this._renderer && this._sourceMesh && this._renderer.mesh === this._cageMesh) {
            this._renderer.mesh = this._sourceMesh;
        }
        for (const material of this._materialInstances) material?.recompileShaders({ USE_CAGE_DEFORM: false });
        this._materialInstances.length = 0;
    }

    protected update(dt: number): void {
        if (!this._renderer || !this._cageMesh || this._controlCount < 2) return;
        this._time += Math.max(0, Math.min(dt, 0.05));

        const settings = {
            stiffness: this.stiffness,
            damping: this.damping,
            maxDisplacement: this.maxDisplacement,
        };

        // Root stays planted. Higher controls receive progressively stronger
        // wind and a phase lag that makes the crown trail behind the trunk.
        this._offsets[0].set(0, 0, 0);
        this._velocities[0].set(0, 0, 0);
        this._targets[0].set(0, 0, 0);

        for (let i = 1; i < this._controlCount; ++i) {
            const height = i / (this._controlCount - 1);
            const amplitude = this.windStrength * height * height;
            const phase = this._time * this.windFrequency * Math.PI * 2 - i * 0.28;
            this._targets[i].set(
                Math.sin(phase) * amplitude,
                0,
                Math.cos(phase * 0.73) * amplitude * 0.35,
            );
            stepCageSpring(this._offsets[i], this._velocities[i], this._targets[i], settings, dt);
        }

        this._uploadControls();
        if (this.debugDraw) this._drawDebug();
    }

    public addImpulse(worldPosition: Vec3, direction: Vec3, strength: number, radius = 2): void {
        if (!this._controlCount || radius <= 0 || strength === 0) return;
        Mat4.invert(_inverseWorld, this.node.worldMatrix);
        Vec3.transformMat4Normal(_localDirection, direction, _inverseWorld);
        Vec3.normalize(_localDirection, _localDirection);

        for (let i = 1; i < this._controlCount; ++i) {
            Vec3.add(_localPoint, this._restControls[i], this._offsets[i]);
            Vec3.transformMat4(_worldControl, _localPoint, this.node.worldMatrix);
            const distance = Vec3.distance(_worldControl, worldPosition);
            if (distance >= radius) continue;
            const falloff = 1 - distance / radius;
            const height = i / (this._controlCount - 1);
            const impulse = strength * falloff * height;
            this._velocities[i].x += _localDirection.x * impulse;
            this._velocities[i].y += _localDirection.y * impulse;
            this._velocities[i].z += _localDirection.z * impulse;
        }
    }

    public resetDeformation(): void {
        for (let i = 0; i < this._controlCount; ++i) {
            this._offsets[i].set(0, 0, 0);
            this._velocities[i].set(0, 0, 0);
            this._targets[i].set(0, 0, 0);
        }
        this._uploadControls();
    }

    private _rebuild(): void {
        if (!this._renderer || !this._sourceMesh) return;
        const count = Math.max(2, Math.min(MAX_CAGE_CONTROLS, Math.floor(this.controlCount)));
        this._controlCount = count;
        this._cageMesh = getCageMesh(this._sourceMesh, count);
        this._renderer.mesh = this._cageMesh;

        this._offsets.length = count;
        this._velocities.length = count;
        this._targets.length = count;
        this._restControls.length = count;
        this._uniformOffsets.length = MAX_CAGE_CONTROLS;

        const min = this._sourceMesh.struct.minPosition ?? Vec3.ZERO;
        const max = this._sourceMesh.struct.maxPosition ?? Vec3.ONE;
        const centerX = (min.x + max.x) * 0.5;
        const centerZ = (min.z + max.z) * 0.5;
        for (let i = 0; i < count; ++i) {
            this._offsets[i] = this._offsets[i] || new Vec3();
            this._velocities[i] = this._velocities[i] || new Vec3();
            this._targets[i] = this._targets[i] || new Vec3();
            this._restControls[i] = this._restControls[i] || new Vec3();
            const t = i / (count - 1);
            this._restControls[i].set(centerX, min.y + (max.y - min.y) * t, centerZ);
        }
        for (let i = 0; i < MAX_CAGE_CONTROLS; ++i) {
            this._uniformOffsets[i] = this._uniformOffsets[i] || new Vec4();
            this._uniformOffsets[i].set(0, 0, 0, 0);
        }

        this._materialInstances.length = 0;
        const materials = this._renderer.sharedMaterials;
        for (let i = 0; i < materials.length; ++i) {
            const material = this._renderer.getMaterialInstance(i);
            if (!material) continue;
            material.recompileShaders({ USE_CAGE_DEFORM: true });
            this._materialInstances.push(material);
        }
        this._uploadControls();
    }

    private _uploadControls(): void {
        for (let i = 0; i < MAX_CAGE_CONTROLS; ++i) {
            const source = i < this._controlCount ? this._offsets[i] : Vec3.ZERO;
            this._uniformOffsets[i].set(source.x, source.y, source.z, 0);
        }

        for (const material of this._materialInstances) {
            if (!material) continue;
            const passes = material.passes;
            for (let passIndex = 0; passIndex < passes.length; ++passIndex) {
                const pass = passes[passIndex];
                for (let i = 0; i < MAX_CAGE_CONTROLS; ++i) {
                    const handle = pass.getHandle(`cageOffset${i}`);
                    if (handle) pass.setUniform(handle, this._uniformOffsets[i]);
                }
                const paramsHandle = pass.getHandle('cageParams');
                if (paramsHandle) {
                    this._uniformOffsets[0].w = this._controlCount;
                    const params = new Vec4(this._controlCount, this.flutterStrength, this._time, this.flutterFrequency);
                    pass.setUniform(paramsHandle, params);
                    this._uniformOffsets[0].w = 0;
                }
            }
        }
    }

    private _drawDebug(): void {
        const root = cclegacy.director.root as any;
        const geometryRenderer = root?.pipeline?.geometryRenderer;
        if (!geometryRenderer) return;
        const color = Color.CYAN;
        for (let i = 0; i < this._controlCount; ++i) {
            Vec3.add(_localPoint, this._restControls[i], this._offsets[i]);
            Vec3.transformMat4(_worldControl, _localPoint, this.node.worldMatrix);
            geometryRenderer.addCross(_worldControl, 0.08, color, true);
            if (i > 0) {
                Vec3.add(_localPoint, this._restControls[i - 1], this._offsets[i - 1]);
                const previous = new Vec3();
                Vec3.transformMat4(previous, _localPoint, this.node.worldMatrix);
                geometryRenderer.addLine(previous, _worldControl, color, true);
            }
        }
    }
}
