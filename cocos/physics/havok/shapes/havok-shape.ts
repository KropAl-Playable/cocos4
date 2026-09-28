/*
 Copyright (c) 2026 KropAl-Playable
 SPDX-License-Identifier: MIT
 */

import { Mesh } from '../../../3d/assets';
import { geometry, IVec3Like, Vec3, warn } from '../../../core';
import { PrimitiveMode } from '../../../gfx';
import {
    BoxCollider,
    CapsuleCollider,
    Collider,
    CylinderCollider,
    EAxisDirection,
    ERigidBodyType,
    MeshCollider,
    EPhysicsMaterialCombine,
    PhysicsMaterial,
    PhysicsSystem,
    RigidBody,
    SphereCollider,
} from '../../framework';
import type { IBaseShape, IBoxShape, ICapsuleShape, ICylinderShape, ISphereShape, ITrimeshShape } from '../../spec/i-physics-shape';
import { HavokSharedBody } from '../havok-shared-body';
import type { HavokModule, HavokQSTransform, HavokResult, HavokShapeId, HavokVector3 } from '../havok-types';
import { assertHavokResult } from '../havok-util';
import type { HavokWorld } from '../havok-world';

const MIN_SIZE = 0.0001;
const IDENTITY_ROTATION: [number, number, number, number] = [0, 0, 0, 1];
const HULL_POSITION_CACHE = new WeakMap<Mesh, number[]>();

function positive (value: number): number { return Math.max(MIN_SIZE, Math.abs(value)); }

function toHavokMaterialCombine (instance: HavokModule, value: EPhysicsMaterialCombine): number {
    switch (value) {
    case EPhysicsMaterialCombine.MINIMUM:
        return instance.MaterialCombine.MINIMUM;
    case EPhysicsMaterialCombine.MAXIMUM:
        return instance.MaterialCombine.MAXIMUM;
    case EPhysicsMaterialCombine.AVERAGE:
        return instance.MaterialCombine.ARITHMETIC_MEAN;
    case EPhysicsMaterialCombine.MULTIPLY:
        return instance.MaterialCombine.MULTIPLY;
    case EPhysicsMaterialCombine.GEOMETRIC_MEAN:
    default:
        return instance.MaterialCombine.GEOMETRIC_MEAN;
    }
}

export abstract class HavokShape implements IBaseShape {
    get impl (): HavokShapeId | null { return this._impl; }
    get collider (): Collider { return this._collider; }
    get attachedRigidBody (): RigidBody | null { return this._collider.attachedRigidBody; }
    get localTransform (): HavokQSTransform { return this._localTransform; }

    protected _collider!: Collider;
    protected _sharedBody!: HavokSharedBody;
    protected _instance!: HavokModule;
    protected _impl: HavokShapeId | null = null;
    protected _enabled = false;
    protected readonly _localTransform: HavokQSTransform = [[0, 0, 0], IDENTITY_ROTATION.slice() as [number, number, number, number], [1, 1, 1]];

    initialize (collider: Collider): void {
        this._collider = collider;
        const world = PhysicsSystem.instance.physicsWorld as HavokWorld;
        this._instance = world.instance;
        this._sharedBody = world.getSharedBody(collider.node);
        this._sharedBody.reference = true;
    }
    onLoad (): void { this.setMaterial(this._collider.sharedMaterial); }
    onEnable (): void { this._enabled = true; this._sharedBody.addShape(this); }
    onDisable (): void { this._enabled = false; this._sharedBody.removeShape(this); }
    onDestroy (): void {
        if (this._enabled) this._sharedBody.removeShape(this);
        else this.destroyShape();
        this._sharedBody.reference = false;
        (this._collider as any) = null;
        (this._sharedBody as any) = null;
    }

    createShape (): void {
        this.destroyShape();
        this._syncCenter();
        try {
            const [result, shape] = this._createGeometry();
            assertHavokResult(this._instance, result, this.constructor.name);
            this._impl = shape;
            this._sharedBody.world.registerShape(this);
        } catch (error) {
            warn(`[havok]: ${String(error)}`);
            return;
        }
        this.syncFilter();
        this.setMaterial(this._collider.sharedMaterial);
        this.setAsTrigger(this._collider.isTrigger);
        assertHavokResult(this._instance, this._instance.HP_Shape_SetDensity(this._impl, 1), 'HP_Shape_SetDensity');
    }
    destroyShape (): void {
        if (!this._impl) return;
        this._sharedBody.world.unregisterShape(this);
        assertHavokResult(this._instance, this._instance.HP_Shape_Release(this._impl), 'HP_Shape_Release');
        this._impl = null;
    }
    setMaterial (value: PhysicsMaterial | null): void {
        if (!this._impl) return;
        const material = value || PhysicsSystem.instance.defaultMaterial;
        const frictionCombine = toHavokMaterialCombine(this._instance, material.frictionCombine);
        const restitutionCombine = toHavokMaterialCombine(this._instance, material.restitutionCombine);
        assertHavokResult(this._instance, this._instance.HP_Shape_SetMaterial(this._impl, [
            material.friction,
            material.friction,
            material.restitution,
            frictionCombine,
            restitutionCombine,
        ]), 'HP_Shape_SetMaterial');
    }
    setAsTrigger (value: boolean): void {
        if (this._impl) assertHavokResult(this._instance, this._instance.HP_Shape_SetTrigger(this._impl, value), 'HP_Shape_SetTrigger');
    }
    setCenter (_value: IVec3Like): void { this._recreate(); }
    getAABB (out: geometry.AABB): void {
        const bounds = this._collider.worldBounds as geometry.AABB;
        Vec3.copy(out.center, bounds.center);
        Vec3.copy(out.halfExtents, bounds.halfExtents);
    }
    getBoundingSphere (out: geometry.Sphere): void { geometry.AABB.toBoundingSphere(out, this._collider.worldBounds as geometry.AABB); }
    updateEventListener (): void { /* Event masks are installed in milestone 4. */ }
    setGroup (value: number): void { this._sharedBody.group = value; }
    getGroup (): number { return this._sharedBody.group; }
    addGroup (value: number): void { this.setGroup(this.getGroup() | value); }
    removeGroup (value: number): void { this.setGroup(this.getGroup() & ~value); }
    setMask (value: number): void { this._sharedBody.mask = value; }
    getMask (): number { return this._sharedBody.mask; }
    addMask (value: number): void { this.setMask(this.getMask() | value); }
    removeMask (value: number): void { this.setMask(this.getMask() & ~value); }
    syncFilter (): void {
        if (this._impl) {
            const result = this._instance.HP_Shape_SetFilterInfo(this._impl, [this.getGroup() >>> 0, this.getMask() >>> 0]);
            assertHavokResult(this._instance, result, 'HP_Shape_SetFilterInfo');
        }
    }

    protected abstract _createGeometry (): [HavokResult, HavokShapeId];
    protected _recreate (): void {
        if (!this._enabled) return;
        if (this._sharedBody.shapes.includes(this)) this._sharedBody.recreateShape(this);
        else this._sharedBody.addShape(this);
    }
    protected _syncCenter (): void {
        const center = this._collider.center;
        const scale = this._collider.node.worldScale;
        this._localTransform[0][0] = center.x * scale.x;
        this._localTransform[0][1] = center.y * scale.y;
        this._localTransform[0][2] = center.z * scale.z;
    }
}

export class HavokBoxShape extends HavokShape implements IBoxShape {
    get collider (): BoxCollider { return this._collider as BoxCollider; }
    updateSize (): void { this._recreate(); }
    protected _createGeometry (): [HavokResult, HavokShapeId] {
        const size = this.collider.size; const scale = this.collider.node.worldScale;
        const extents: HavokVector3 = [positive(size.x * scale.x), positive(size.y * scale.y), positive(size.z * scale.z)];
        return this._instance.HP_Shape_CreateBox([0, 0, 0], IDENTITY_ROTATION, extents);
    }
}

export class HavokSphereShape extends HavokShape implements ISphereShape {
    get collider (): SphereCollider { return this._collider as SphereCollider; }
    updateRadius (): void { this._recreate(); }
    protected _createGeometry (): [HavokResult, HavokShapeId] {
        const scale = this.collider.node.worldScale;
        const radiusScale = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
        return this._instance.HP_Shape_CreateSphere([0, 0, 0], positive(this.collider.radius * radiusScale));
    }
}

abstract class HavokAxialShape extends HavokShape {
    protected _axisPoints (direction: EAxisDirection, halfHeight: number, scale: Readonly<IVec3Like>): [HavokVector3, HavokVector3, number] {
        let axialScale = Math.abs(scale.y); let radialScale = Math.max(Math.abs(scale.x), Math.abs(scale.z));
        if (direction === EAxisDirection.X_AXIS) {
            axialScale = Math.abs(scale.x);
            radialScale = Math.max(Math.abs(scale.y), Math.abs(scale.z));
        } else if (direction === EAxisDirection.Z_AXIS) {
            axialScale = Math.abs(scale.z);
            radialScale = Math.max(Math.abs(scale.x), Math.abs(scale.y));
        }
        const half = positive(halfHeight * axialScale);
        const a: HavokVector3 = [0, -half, 0]; const b: HavokVector3 = [0, half, 0];
        if (direction === EAxisDirection.X_AXIS) {
            a[0] = -half; a[1] = 0; b[0] = half; b[1] = 0;
        } else if (direction === EAxisDirection.Z_AXIS) {
            a[2] = -half; a[1] = 0; b[2] = half; b[1] = 0;
        }
        return [a, b, radialScale];
    }
}

export class HavokCapsuleShape extends HavokAxialShape implements ICapsuleShape {
    get collider (): CapsuleCollider { return this._collider as CapsuleCollider; }
    setRadius (_value: number): void { this._recreate(); }
    setCylinderHeight (_value: number): void { this._recreate(); }
    setDirection (_value: number): void { this._recreate(); }
    protected _createGeometry (): [HavokResult, HavokShapeId] {
        const [a, b, radialScale] = this._axisPoints(this.collider.direction, this.collider.cylinderHeight * 0.5, this.collider.node.worldScale);
        return this._instance.HP_Shape_CreateCapsule(a, b, positive(this.collider.radius * radialScale));
    }
}

export class HavokCylinderShape extends HavokAxialShape implements ICylinderShape {
    get collider (): CylinderCollider { return this._collider as CylinderCollider; }
    setRadius (_value: number): void { this._recreate(); }
    setHeight (_value: number): void { this._recreate(); }
    setDirection (_value: number): void { this._recreate(); }
    protected _createGeometry (): [HavokResult, HavokShapeId] {
        const [a, b, radialScale] = this._axisPoints(this.collider.direction, this.collider.height * 0.5, this.collider.node.worldScale);
        return this._instance.HP_Shape_CreateCylinder(a, b, positive(this.collider.radius * radialScale));
    }
}

export class HavokTrimeshShape extends HavokShape implements ITrimeshShape {
    get collider (): MeshCollider { return this._collider as MeshCollider; }
    setMesh (_value: Mesh | null): void { this._recreate(); }
    protected _createGeometry (): [HavokResult, HavokShapeId] {
        const mesh = this.collider.mesh;
        if (!mesh) throw new Error('[havok]: MeshCollider has no mesh.');
        const positions = this._getPositions(mesh);
        if (positions.length < 9) throw new Error('[havok]: mesh collider needs at least three valid vertices.');
        const scale = this.collider.node.worldScale; const center = this.collider.center;
        const vertices = new Float32Array(positions.length);
        for (let i = 0; i < positions.length; i += 3) {
            vertices[i] = (positions[i] + center.x) * scale.x;
            vertices[i + 1] = (positions[i + 1] + center.y) * scale.y;
            vertices[i + 2] = (positions[i + 2] + center.z) * scale.z;
        }
        this._localTransform[0][0] = this._localTransform[0][1] = this._localTransform[0][2] = 0;
        const vertexPtr = this._instance._malloc(vertices.byteLength);
        this._instance.HEAPF32.set(vertices, vertexPtr >> 2);
        try {
            if (this.collider.convex) {
                if (!this._isValidHull(vertices)) throw new Error('convex MeshCollider geometry is degenerate.');
                return this._instance.HP_Shape_CreateConvexHull(vertexPtr, vertices.length / 3);
            }
            if (this.attachedRigidBody?.type === ERigidBodyType.DYNAMIC) {
                throw new Error('[havok]: dynamic triangle MeshCollider requires convex=true.');
            }
            const indices = this._getIndices(mesh, vertices);
            if (indices.length < 3) throw new Error('[havok]: mesh collider has no valid triangles.');
            const indexPtr = this._instance._malloc(indices.byteLength);
            this._instance.HEAPU32.set(indices, indexPtr >> 2);
            try {
                return this._instance.HP_Shape_CreateMesh(vertexPtr, vertices.length / 3, indexPtr, indices.length / 3);
            } finally { this._instance._free(indexPtr); }
        } finally { this._instance._free(vertexPtr); }
    }
    private _getPositions (mesh: Mesh): number[] {
        const cached = HULL_POSITION_CACHE.get(mesh); if (cached) return cached;
        const result: number[] = [];
        for (const subMesh of mesh.renderingSubMeshes) {
            if (subMesh.primitiveMode !== PrimitiveMode.TRIANGLE_LIST) continue;
            const source = subMesh.geometricInfo.positions;
            if (source) for (let i = 0; i < source.length; i++) result.push(source[i]);
        }
        HULL_POSITION_CACHE.set(mesh, result);
        return result;
    }
    private _getIndices (mesh: Mesh, vertices: Float32Array): Uint32Array {
        const result: number[] = []; let base = 0;
        for (const subMesh of mesh.renderingSubMeshes) {
            if (subMesh.primitiveMode !== PrimitiveMode.TRIANGLE_LIST) continue;
            const info = subMesh.geometricInfo; const count = Math.floor((info.positions?.length ?? 0) / 3);
            const source = info.indices;
            if (source) for (let i = 0; i + 2 < source.length; i += 3) result.push(base + source[i], base + source[i + 1], base + source[i + 2]);
            else for (let i = 0; i + 2 < count; i += 3) result.push(base + i, base + i + 1, base + i + 2);
            base += count;
        }
        const valid: number[] = []; const vertexCount = vertices.length / 3;
        const flip = this.collider.node.worldScale.x * this.collider.node.worldScale.y * this.collider.node.worldScale.z < 0;
        for (let i = 0; i + 2 < result.length; i += 3) {
            const a = result[i]; const b = result[i + 1]; const c = result[i + 2];
            if (a < 0 || b < 0 || c < 0 || a >= vertexCount || b >= vertexCount || c >= vertexCount) continue;
            const ax = vertices[a * 3]; const ay = vertices[a * 3 + 1]; const az = vertices[a * 3 + 2];
            const abx = vertices[b * 3] - ax; const aby = vertices[b * 3 + 1] - ay; const abz = vertices[b * 3 + 2] - az;
            const acx = vertices[c * 3] - ax; const acy = vertices[c * 3 + 1] - ay; const acz = vertices[c * 3 + 2] - az;
            const cx = aby * acz - abz * acy; const cy = abz * acx - abx * acz; const cz = abx * acy - aby * acx;
            if (cx * cx + cy * cy + cz * cz <= 1e-12) continue;
            valid.push(a, flip ? c : b, flip ? b : c);
        }
        if (valid.length !== result.length) warn('[havok]: invalid or degenerate mesh triangles were discarded.');
        return new Uint32Array(valid);
    }
    private _isValidHull (vertices: Float32Array): boolean {
        const count = vertices.length / 3;
        if (count < 4) return false;
        const p0x = vertices[0]; const p0y = vertices[1]; const p0z = vertices[2];
        let p1 = 1; let maxDistance = 0;
        for (let i = 1; i < count; i++) {
            const dx = vertices[i * 3] - p0x; const dy = vertices[i * 3 + 1] - p0y; const dz = vertices[i * 3 + 2] - p0z;
            const distance = dx * dx + dy * dy + dz * dz;
            if (distance > maxDistance) { maxDistance = distance; p1 = i; }
        }
        if (maxDistance <= 1e-12) return false;
        const lx = vertices[p1 * 3] - p0x; const ly = vertices[p1 * 3 + 1] - p0y; const lz = vertices[p1 * 3 + 2] - p0z;
        let p2 = 0; let maxArea = 0;
        for (let i = 1; i < count; i++) {
            const dx = vertices[i * 3] - p0x; const dy = vertices[i * 3 + 1] - p0y; const dz = vertices[i * 3 + 2] - p0z;
            const cx = ly * dz - lz * dy; const cy = lz * dx - lx * dz; const cz = lx * dy - ly * dx;
            const area = cx * cx + cy * cy + cz * cz;
            if (area > maxArea) { maxArea = area; p2 = i; }
        }
        if (maxArea <= 1e-12) return false;
        const p2x = vertices[p2 * 3] - p0x; const p2y = vertices[p2 * 3 + 1] - p0y; const p2z = vertices[p2 * 3 + 2] - p0z;
        const nx = ly * p2z - lz * p2y; const ny = lz * p2x - lx * p2z; const nz = lx * p2y - ly * p2x;
        for (let i = 1; i < count; i++) {
            const dx = vertices[i * 3] - p0x; const dy = vertices[i * 3 + 1] - p0y; const dz = vertices[i * 3 + 2] - p0z;
            if (Math.abs(nx * dx + ny * dy + nz * dz) > 1e-9) return true;
        }
        return false;
    }
}
