import { EDITOR } from 'internal:constants';
/*
 Copyright (c) 2017-2023 Xiamen Yaji Software Co., Ltd.

 https://www.cocos.com/
*/

import { Color, Mat4, Quat, Vec3, Vec4, _decorator, CCBoolean, CCFloat, CCInteger, cclegacy } from '../../core';
import { Component } from '../../scene-graph';
import { Mesh } from '../assets/mesh';
import { MeshRenderer } from './mesh-renderer';
import { buildDefaultCageLayout, createCageInfluenceMesh, hasCageInfluenceData, MAX_CAGE_CONTROLS, stepCageSpring } from '../misc/cage-deform';

const { ccclass, executeInEditMode, menu, property, requireComponent, range } = _decorator;

const _inverseWorld = new Mat4();
const _localDirection = new Vec3();
const _worldControl = new Vec3();
const _localPoint = new Vec3();
const _debugPrevious = new Vec3();
const _restDelta = new Vec3();
const _rotatedDelta = new Vec3();
const _localRotation = new Quat();
const DEBUG_COLOR = new Color(0, 255, 255, 255);

const MESH_CACHE = new WeakMap<Mesh, Map<number, Mesh>>();

function getCageMesh(source: Mesh, controlCount: number): Mesh {
    // Offline/editor-baked meshes can be consumed directly. Runtime generation
    // remains as a fallback for prototypes and legacy scenes.
    if (hasCageInfluenceData(source)) return source;

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
 * Lightweight hierarchical GPU cage deformation for vegetation.
 *
 * CPU simulates only bend angles for a small control hierarchy. The dense mesh
 * uses four precomputed influences and is deformed entirely in the vertex stage.
 */
@ccclass('cc.CageDeformer')
@menu('Mesh/CageDeformer')
@executeInEditMode
@requireComponent(MeshRenderer)
export class CageDeformer extends Component {
    @property({ type: CCInteger })
    @range([2, MAX_CAGE_CONTROLS, 1])
    public controlCount = 7;

    @property({ type: CCFloat })
    @range([0, 1.5, 0.001])
    public windStrength = 0.12;

    @property({ type: CCFloat })
    @range([0, 5, 0.01])
    public windFrequency = 0.8;

    @property({ type: CCFloat })
    @range([0, 100, 0.1])
    public stiffness = 22;

    @property({ type: CCFloat })
    @range([0, 1, 0.001])
    public damping = 0.86;

    @property({ type: CCFloat })
    @range([0, 1.5, 0.001])
    public maxBendAngle = 0.35;

    @property({ type: CCFloat })
    @range([0, 1, 0.001])
    public flutterStrength = 0.01;

    @property({ type: CCFloat })
    @range([0, 20, 0.01])
    public flutterFrequency = 5;

    @property({ type: CCBoolean })
    public previewInEditor = false;

    @property({ type: CCBoolean })
    public debugDraw = false;

    private _renderer: MeshRenderer | null = null;
    private _sourceMesh: Mesh | null = null;
    private _cageMesh: Mesh | null = null;
    private _controlCount = 0;
    private _trunkCount = 0;
    private _time = 0;
    private _simulationAccumulator = 0;

    private _parents: number[] = [];
    private _restControls: Vec3[] = [];
    private _bendAngles: Vec3[] = [];
    private _angularVelocities: Vec3[] = [];
    private _angleTargets: Vec3[] = [];
    private _globalPositions: Vec3[] = [];
    private _globalRotations: Quat[] = [];

    private _uniformRest: Vec4[] = [];
    private _uniformOffsets: Vec4[] = [];
    private _uniformRotations: Vec4[] = [];
    private _params = new Vec4();
    private _springSettings = {
        stiffness: 22,
        damping: 0.86,
        maxDisplacement: 0.35,
    };
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
        if (EDITOR && !this.previewInEditor) return;
        if (!this._renderer || !this._cageMesh || this._controlCount < 2) return;

        // Fixed-step control simulation keeps browser preview and editor preview
        // visually consistent even when their edit-mode tick rates differ.
        const frameDt = Math.max(0, Math.min(dt, 0.1));
        this._simulationAccumulator = Math.min(this._simulationAccumulator + frameDt, 0.1);
        const fixedDt = 1 / 60;
        let steps = 0;
        while (this._simulationAccumulator >= fixedDt && steps < 6) {
            this._simulateStep(fixedDt);
            this._simulationAccumulator -= fixedDt;
            ++steps;
        }

        this._updateHierarchy();
        this._uploadControls();
        if (this.debugDraw) this._drawDebug();
    }

    private _simulateStep(dt: number): void {
        this._time += dt;
        this._springSettings.stiffness = this.stiffness;
        this._springSettings.damping = this.damping;
        this._springSettings.maxDisplacement = this.maxBendAngle;

        this._bendAngles[0].set(0, 0, 0);
        this._angularVelocities[0].set(0, 0, 0);
        this._angleTargets[0].set(0, 0, 0);

        const basePhase = this._time * this.windFrequency * Math.PI * 2;
        const trunkSegments = Math.max(1, this._trunkCount - 1);

        for (let i = 1; i < this._controlCount; ++i) {
            const isTrunk = i < this._trunkCount;
            if (isTrunk) {
                const height = i / Math.max(1, this._trunkCount - 1);
                // All trunk segments bend in the same broad direction. Each local
                // segment contributes only a fraction of the total bend, so the
                // accumulated hierarchy forms a smooth arc instead of soft shearing.
                const localAmplitude = this.windStrength
                    * (0.30 + 0.70 * height)
                    / trunkSegments;
                const laggedPhase = basePhase - height * 0.08;
                this._angleTargets[i].set(
                    Math.cos(laggedPhase * 0.67) * localAmplitude * 0.22,
                    0,
                    -Math.sin(laggedPhase) * localAmplitude,
                );
            } else {
                // Crown controls inherit the trunk motion from their parent. Their
                // own local rotation is intentionally subtle secondary motion only.
                const branchIndex = i - this._trunkCount;
                const branchPhase = basePhase - 0.14 - branchIndex * 0.11;
                const branchAmplitude = this.windStrength * 0.16;
                this._angleTargets[i].set(
                    Math.cos(branchPhase * 0.79) * branchAmplitude * 0.35,
                    0,
                    -Math.sin(branchPhase) * branchAmplitude,
                );
            }

            stepCageSpring(
                this._bendAngles[i],
                this._angularVelocities[i],
                this._angleTargets[i],
                this._springSettings,
                dt,
            );
        }
    }

    public addImpulse(worldPosition: Vec3, direction: Vec3, strength: number, radius = 2): void {
        if (!this._controlCount || radius <= 0 || strength === 0) return;
        Mat4.invert(_inverseWorld, this.node.worldMatrix);
        Vec3.transformMat4Normal(_localDirection, direction, _inverseWorld);
        Vec3.normalize(_localDirection, _localDirection);

        for (let i = 1; i < this._controlCount; ++i) {
            Vec3.transformMat4(_worldControl, this._globalPositions[i], this.node.worldMatrix);
            const distance = Vec3.distance(_worldControl, worldPosition);
            if (distance >= radius) continue;
            const falloff = 1 - distance / radius;
            const height = this._normalizedControlHeight(i);
            const impulse = strength * falloff * Math.max(0.15, height);

            // Rotation around Z bends along X; rotation around X bends along Z.
            this._angularVelocities[i].x += _localDirection.z * impulse;
            this._angularVelocities[i].z -= _localDirection.x * impulse;
        }
    }

    public resetDeformation(): void {
        for (let i = 0; i < this._controlCount; ++i) {
            this._bendAngles[i].set(0, 0, 0);
            this._angularVelocities[i].set(0, 0, 0);
            this._angleTargets[i].set(0, 0, 0);
        }
        this._updateHierarchy();
        this._uploadControls();
    }

    private _rebuild(): void {
        if (!this._renderer || !this._sourceMesh) return;
        const count = Math.max(2, Math.min(MAX_CAGE_CONTROLS, Math.floor(this.controlCount)));
        this._controlCount = count;
        this._cageMesh = getCageMesh(this._sourceMesh, count);
        this._renderer.mesh = this._cageMesh;

        const layout = buildDefaultCageLayout(this._sourceMesh, count);
        this._parents = layout.parents.slice();
        this._trunkCount = layout.trunkCount;
        this._simulationAccumulator = 0;

        this._restControls.length = count;
        this._bendAngles.length = count;
        this._angularVelocities.length = count;
        this._angleTargets.length = count;
        this._globalPositions.length = count;
        this._globalRotations.length = count;

        for (let i = 0; i < count; ++i) {
            this._restControls[i] = this._restControls[i] || new Vec3();
            this._restControls[i].set(layout.positions[i]);
            this._bendAngles[i] = this._bendAngles[i] || new Vec3();
            this._angularVelocities[i] = this._angularVelocities[i] || new Vec3();
            this._angleTargets[i] = this._angleTargets[i] || new Vec3();
            this._globalPositions[i] = this._globalPositions[i] || new Vec3();
            this._globalRotations[i] = this._globalRotations[i] || new Quat();
            this._bendAngles[i].set(0, 0, 0);
            this._angularVelocities[i].set(0, 0, 0);
            this._angleTargets[i].set(0, 0, 0);
        }

        this._uniformRest.length = MAX_CAGE_CONTROLS;
        this._uniformOffsets.length = MAX_CAGE_CONTROLS;
        this._uniformRotations.length = MAX_CAGE_CONTROLS;
        for (let i = 0; i < MAX_CAGE_CONTROLS; ++i) {
            this._uniformRest[i] = this._uniformRest[i] || new Vec4();
            this._uniformOffsets[i] = this._uniformOffsets[i] || new Vec4();
            this._uniformRotations[i] = this._uniformRotations[i] || new Vec4(0, 0, 0, 1);
        }

        this._updateHierarchy();

        this._materialInstances.length = 0;
        const materials = this._renderer.sharedMaterials;
        for (let i = 0; i < materials.length; ++i) {
            const material = this._renderer.getMaterialInstance(i);
            if (!material) continue;
            const effectName = material.effectAsset?.name || '';
            if (!effectName.includes('builtin-standard-cage')) continue;
            material.recompileShaders({ USE_CAGE_DEFORM: true });
            this._materialInstances.push(material);
        }
        this._uploadControls();
    }

    private _updateHierarchy(): void {
        for (let i = 0; i < this._controlCount; ++i) {
            Quat.identity(_localRotation);
            Quat.rotateX(_localRotation, _localRotation, this._bendAngles[i].x);
            Quat.rotateZ(_localRotation, _localRotation, this._bendAngles[i].z);

            const parent = this._parents[i];
            if (parent < 0) {
                this._globalPositions[i].set(this._restControls[i]);
                Quat.copy(this._globalRotations[i], _localRotation);
                continue;
            }

            Vec3.subtract(_restDelta, this._restControls[i], this._restControls[parent]);
            Vec3.transformQuat(_rotatedDelta, _restDelta, this._globalRotations[parent]);
            Vec3.add(this._globalPositions[i], this._globalPositions[parent], _rotatedDelta);
            Quat.multiply(this._globalRotations[i], this._globalRotations[parent], _localRotation);
            Quat.normalize(this._globalRotations[i], this._globalRotations[i]);
        }
    }

    private _uploadControls(): void {
        for (let i = 0; i < MAX_CAGE_CONTROLS; ++i) {
            if (i < this._controlCount) {
                const rest = this._restControls[i];
                const current = this._globalPositions[i];
                const rotation = this._globalRotations[i];
                this._uniformRest[i].set(rest.x, rest.y, rest.z, 0);
                this._uniformOffsets[i].set(current.x - rest.x, current.y - rest.y, current.z - rest.z, 0);
                this._uniformRotations[i].set(rotation.x, rotation.y, rotation.z, rotation.w);
            } else {
                this._uniformRest[i].set(0, 0, 0, 0);
                this._uniformOffsets[i].set(0, 0, 0, 0);
                this._uniformRotations[i].set(0, 0, 0, 1);
            }
        }

        for (const material of this._materialInstances) {
            if (!material) continue;
            for (const pass of material.passes) {
                for (let i = 0; i < MAX_CAGE_CONTROLS; ++i) {
                    let handle = pass.getHandle(`cageRest${i}`);
                    if (handle) pass.setUniform(handle, this._uniformRest[i]);
                    handle = pass.getHandle(`cageOffset${i}`);
                    if (handle) pass.setUniform(handle, this._uniformOffsets[i]);
                    handle = pass.getHandle(`cageRotation${i}`);
                    if (handle) pass.setUniform(handle, this._uniformRotations[i]);
                }
                const paramsHandle = pass.getHandle('cageParams');
                if (paramsHandle) {
                    this._params.set(this._controlCount, this.flutterStrength, this._time, this.flutterFrequency);
                    pass.setUniform(paramsHandle, this._params);
                }
            }
        }
    }

    private _normalizedControlHeight(index: number): number {
        if (!this._restControls.length) return 0;
        const rootY = this._restControls[0].y;
        let topY = rootY + 1;
        for (let i = 1; i < this._restControls.length; ++i) topY = Math.max(topY, this._restControls[i].y);
        return Math.max(0, Math.min(1, (this._restControls[index].y - rootY) / Math.max(1e-6, topY - rootY)));
    }

    private _drawDebug(): void {
        const root = cclegacy.director.root as any;
        const cameras = root?.cameraList as any[] | undefined;
        if (!cameras?.length) return;

        // GeometryRenderer moved to Camera; WebPipeline.geometryRenderer is an
        // unimplemented compatibility getter in Cocos 4 and must not be touched.
        for (const camera of cameras) {
            camera.initGeometryRenderer?.();
            const geometryRenderer = camera.geometryRenderer;
            if (!geometryRenderer) continue;

            for (let i = 0; i < this._controlCount; ++i) {
                Vec3.transformMat4(_worldControl, this._globalPositions[i], this.node.worldMatrix);
                geometryRenderer.addCross(_worldControl, 0.08, DEBUG_COLOR, true);
                const parent = this._parents[i];
                if (parent >= 0) {
                    Vec3.transformMat4(_debugPrevious, this._globalPositions[parent], this.node.worldMatrix);
                    geometryRenderer.addLine(_debugPrevious, _worldControl, DEBUG_COLOR, true);
                }
            }
        }
    }

}
