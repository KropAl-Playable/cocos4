/*
 Copyright (c) 2026 KropAl-Playable
 SPDX-License-Identifier: MIT
 */

import { Mat3, Quat, Vec3 } from '../../core';
import { Node, TransformBit } from '../../scene-graph';
import { ERigidBodyType, PhysicsGroup, PhysicsSystem } from '../framework';
import type { HavokRigidBody } from './havok-rigid-body';
import type { HavokShape } from './shapes/havok-shape';
import type { HavokBodyId, HavokModule, HavokQTransform, HavokShapeId } from './havok-types';
import { assertHavokResult, toHavokQuaternion, toHavokVector3 } from './havok-util';
import type { HavokWorld } from './havok-world';

const WORLD_MATRIX_USED_INDICES = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14] as const;

export class HavokSharedBody {
    private static readonly _map = new Map<string, HavokSharedBody>();

    static get (node: Node, world: HavokWorld, wrappedBody?: HavokRigidBody): HavokSharedBody {
        let shared = this._map.get(node.uuid);
        if (!shared) {
            shared = new HavokSharedBody(node, world);
            this._map.set(node.uuid, shared);
        }
        if (wrappedBody) {
            shared._wrappedBody = wrappedBody;
            shared._group = wrappedBody.rigidBody.group;
            shared._mask = PhysicsSystem.instance.collisionMatrix[shared._group];
        }
        return shared;
    }

    readonly shapes: HavokShape[] = [];
    readonly node: Node;
    readonly world: HavokWorld;

    get bodyId (): HavokBodyId { this._ensureBody(); return this._body!; }
    get containerId (): HavokShapeId { this._ensureBody(); return this._container!; }
    get wrappedBody (): HavokRigidBody | null { return this._wrappedBody; }
    get group (): number { return this._group; }
    set group (value: number) { this._group = value >>> 0; this._syncFilters(); }
    get mask (): number { return this._mask; }
    set mask (value: number) { this._mask = value >>> 0; this._syncFilters(); }

    private readonly _instance: HavokModule;
    private readonly _transform: HavokQTransform = [[0, 0, 0], [0, 0, 0, 1]];
    private readonly _position = new Vec3();
    private readonly _rotation = new Quat();
    private readonly _rotationMatrix = new Mat3();
    private readonly _lastWorldMatrix = new Float32Array(12).fill(Number.NaN);
    private _worldTransformOffset = -1;
    private _body: HavokBodyId | null = null;
    private _container: HavokShapeId | null = null;
    private _wrappedBody: HavokRigidBody | null = null;
    private _references = 0;
    private _inWorld = false;
    private _group = PhysicsGroup.DEFAULT;
    private _mask = -1;

    private constructor (node: Node, world: HavokWorld) {
        this.node = node;
        this.world = world;
        this._instance = world.instance;
        this._mask = PhysicsSystem.instance.collisionMatrix[PhysicsGroup.DEFAULT];
    }

    set reference (value: boolean) {
        this._references += value ? 1 : -1;
        if (this._references <= 0) this.destroy();
    }

    addShape (shape: HavokShape): void {
        if (this.shapes.includes(shape)) return;
        this._ensureBody();
        shape.createShape();
        if (!shape.impl) return;
        this.shapes.push(shape);
        assertHavokResult(this._instance, this._instance.HP_Shape_AddChild(this.containerId, shape.impl, shape.localTransform), 'HP_Shape_AddChild');
        this._wrappedBody?.reapplyMassProperties();
    }

    removeShape (shape: HavokShape): void {
        const index = this.shapes.indexOf(shape);
        if (index < 0) return;
        assertHavokResult(this._instance, this._instance.HP_Shape_RemoveChild(this.containerId, index), 'HP_Shape_RemoveChild');
        this.shapes.splice(index, 1);
        shape.destroyShape();
        this._wrappedBody?.reapplyMassProperties();
    }

    recreateShape (shape: HavokShape): void {
        if (!this.shapes.includes(shape)) return;
        this.removeShape(shape);
        this.addShape(shape);
    }

    setType (type: ERigidBodyType): void {
        const motionType = type === ERigidBodyType.DYNAMIC
            ? this._instance.MotionType.DYNAMIC
            : type === ERigidBodyType.KINEMATIC ? this._instance.MotionType.KINEMATIC : this._instance.MotionType.STATIC;
        assertHavokResult(this._instance, this._instance.HP_Body_SetMotionType(this.bodyId, motionType), 'HP_Body_SetMotionType');
    }

    syncSceneToPhysics (): void {
        if (!this._body) return;
        if ((this.node.hasChangedFlags & TransformBit.SCALE) !== 0) {
            const snapshot = this.shapes.slice();
            for (let i = 0; i < snapshot.length; i++) this.recreateShape(snapshot[i]);
        }
        const type = this._wrappedBody?.rigidBody.type ?? ERigidBodyType.STATIC;
        const transformChanged = (this.node.hasChangedFlags & TransformBit.TRS) !== 0;
        if (!transformChanged) return;
        this._writeSceneTransform();
        const operation = type === ERigidBodyType.KINEMATIC ? 'HP_Body_SetTargetQTransform' : 'HP_Body_SetQTransform';
        const result = type === ERigidBodyType.KINEMATIC
            ? this._instance.HP_Body_SetTargetQTransform(this._body, this._transform)
            : this._instance.HP_Body_SetQTransform(this._body, this._transform);
        assertHavokResult(this._instance, result, operation);
        if (type === ERigidBodyType.DYNAMIC) this._wrappedBody?.wakeUp();
    }

    syncPhysicsToScene (bodyBuffer?: number): boolean {
        if (!this._body || !this._wrappedBody?.rigidBody.isDynamic) return false;
        if (bodyBuffer !== undefined && this._worldTransformOffset >= 0) {
            return this._syncFromBodyBuffer(bodyBuffer);
        }
        if (!this._wrappedBody.isAwake) return false;
        const [result, transform] = this._instance.HP_Body_GetQTransform(this._body);
        assertHavokResult(this._instance, result, 'HP_Body_GetQTransform');
        this._position.set(transform[0][0], transform[0][1], transform[0][2]);
        this._rotation.set(transform[1][0], transform[1][1], transform[1][2], transform[1][3]);
        if (!Number.isFinite(this._position.x + this._position.y + this._position.z + this._rotation.w)) return false;
        this.node.setWorldPosition(this._position);
        this.node.setWorldRotation(this._rotation);
        return true;
    }

    refreshTransformOffset (): void {
        if (!this._body) { this._worldTransformOffset = -1; return; }
        const [result, offset] = this._instance.HP_Body_GetWorldTransformOffset(this._body);
        assertHavokResult(this._instance, result, 'HP_Body_GetWorldTransformOffset');
        this._worldTransformOffset = offset;
        this._lastWorldMatrix.fill(Number.NaN);
    }

    beforeStep (fixedTimeStep: number): void { this._wrappedBody?.beforeStep(fixedTimeStep); }
    afterStep (): void { this._wrappedBody?.afterStep(); }

    destroy (): void {
        HavokSharedBody._map.delete(this.node.uuid);
        const snapshot = this.shapes.slice();
        for (let i = snapshot.length - 1; i >= 0; i--) this.removeShape(snapshot[i]);
        if (this._body) {
            if (this._inWorld) this.world.removeBody(this);
            assertHavokResult(this._instance, this._instance.HP_Body_Release(this._body), 'HP_Body_Release');
            this._body = null;
            this._worldTransformOffset = -1;
        }
        if (this._container) {
            assertHavokResult(this._instance, this._instance.HP_Shape_Release(this._container), 'HP_Shape_Release');
            this._container = null;
        }
    }

    private _ensureBody (): void {
        if (this._body) return;
        const [shapeResult, container] = this._instance.HP_Shape_CreateContainer();
        assertHavokResult(this._instance, shapeResult, 'HP_Shape_CreateContainer');
        this._container = container;
        const [bodyResult, body] = this._instance.HP_Body_Create();
        assertHavokResult(this._instance, bodyResult, 'HP_Body_Create');
        this._body = body;
        assertHavokResult(this._instance, this._instance.HP_Body_SetShape(body, container), 'HP_Body_SetShape');
        assertHavokResult(this._instance, this._instance.HP_Body_SetEventMask(body, 0x1f), 'HP_Body_SetEventMask');
        this.setType(this._wrappedBody?.rigidBody.type ?? ERigidBodyType.STATIC);
        this._writeSceneTransform();
        assertHavokResult(this._instance, this._instance.HP_Body_SetQTransform(body, this._transform), 'HP_Body_SetQTransform');
        this.world.addBody(this, this, false);
        this._inWorld = true;
    }

    private _writeSceneTransform (): void {
        toHavokVector3(this.node.worldPosition, this._transform[0]);
        toHavokQuaternion(this.node.worldRotation, this._transform[1]);
    }

    private _syncFromBodyBuffer (bodyBuffer: number): boolean {
        const heap = this._instance.HEAPF32;
        const start = (bodyBuffer + this._worldTransformOffset) >> 2;
        if (start < 0 || start + 14 >= heap.length) return false;
        let changed = false;
        for (let i = 0; i < WORLD_MATRIX_USED_INDICES.length; i++) {
            const value = heap[start + WORLD_MATRIX_USED_INDICES[i]];
            if (this._lastWorldMatrix[i] !== value) changed = true;
            this._lastWorldMatrix[i] = value;
        }
        if (!changed) return false;
        this._position.set(heap[start + 12], heap[start + 13], heap[start + 14]);
        this._rotationMatrix.m00 = heap[start];
        this._rotationMatrix.m01 = heap[start + 1];
        this._rotationMatrix.m02 = heap[start + 2];
        this._rotationMatrix.m03 = heap[start + 4];
        this._rotationMatrix.m04 = heap[start + 5];
        this._rotationMatrix.m05 = heap[start + 6];
        this._rotationMatrix.m06 = heap[start + 8];
        this._rotationMatrix.m07 = heap[start + 9];
        this._rotationMatrix.m08 = heap[start + 10];
        Quat.normalize(this._rotation, Quat.fromMat3(this._rotation, this._rotationMatrix));
        if (!Number.isFinite(this._position.x + this._position.y + this._position.z + this._rotation.w)) return false;
        this.node.setWorldPosition(this._position);
        this.node.setWorldRotation(this._rotation);
        return true;
    }

    private _syncFilters (): void {
        for (let i = 0; i < this.shapes.length; i++) this.shapes[i].syncFilter();
    }
}
