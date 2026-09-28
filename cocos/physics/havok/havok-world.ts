/*
 Copyright (c) 2026 KropAl-Playable
 SPDX-License-Identifier: MIT
 */

import { geometry, IQuatLike, IVec3Like, RecyclePool, Vec3 } from '../../core';
import type { Node } from '../../scene-graph';
import type { Collider, CollisionEventType, ICollisionEvent, RigidBody, TriggerEventType } from '../framework';
import { EPhysicsDrawFlags, PhysicsMaterial, PhysicsRayResult } from '../framework';
import type { IPhysicsWorld, IRaycastOptions } from '../spec/i-physics-world';
import { HavokHandleRegistry } from './havok-handle-registry';
import { HavokContact } from './havok-contact';
import { HavokSharedBody } from './havok-shared-body';
import type { HavokRigidBody } from './havok-rigid-body';
import { havokLoader } from './havok-loader';
import type {
    HavokBodyId,
    HavokCollectorId,
    HavokContactPoint,
    HavokFilterInfo,
    HavokModule,
    HavokQuaternion,
    HavokRayCastInput,
    HavokShapeCastInput,
    HavokShapeId,
    HavokShapeProximityInput,
    HavokVector3,
    HavokWorldId,
} from './havok-types';
import { assertHavokResult, isHavokResultOk, toHavokVector3 } from './havok-util';
import type { HavokShape } from './shapes/havok-shape';

// Keep the engine ES2015 runtime target while using Havok's bigint handles.
// Access BigInt through a structural globalThis cast so declaration generation
// does not require the ES2020 lib solely for the BigInt constructor symbol.
const HAVOK_ZERO_ID = (globalThis as unknown as { BigInt: (value: number) => bigint }).BigInt(0);

const QUERY_COLLECTOR_CAPACITY = 256;

export interface IHavokBodySync {
    readonly bodyId: HavokBodyId;
    syncSceneToPhysics (): void;
    syncPhysicsToScene (bodyBuffer?: number): boolean | void;
    refreshTransformOffset? (): void;
    beforeStep? (fixedTimeStep: number): void;
    afterStep? (): void;
}

export interface HavokPerformanceStats {
    stepMilliseconds: number;
    transformSyncMilliseconds: number;
    synchronizedBodies: number;
    skippedBodies: number;
    wasmMemoryBytes: number;
}

export interface HavokProximityHit {
    readonly collider: Collider;
    readonly point: Vec3;
    readonly normal: Vec3;
    readonly distance: number;
    readonly triangleIndex: number;
}

export class HavokWorld implements IPhysicsWorld {
    get instance (): HavokModule { return this._instance; }
    get impl (): HavokWorldId | null {
        return this._world;
    }

    debugDrawFlags = EPhysicsDrawFlags.NONE;
    debugDrawConstraintSize = 0.3;

    readonly bodyRegistry = new HavokHandleRegistry<object, HavokBodyId, IHavokBodySync>();
    readonly shapeRegistry = new HavokHandleRegistry<object, HavokShapeId, HavokShape>();

    private readonly _instance: HavokModule;
    private readonly _bodies: IHavokBodySync[] = [];
    private readonly _gravity: HavokVector3 = [0, -10, 0];
    private _world: HavokWorldId | null;
    private _queryCollector: HavokCollectorId | null;
    private _idealStepTime = -1;
    private _allowSleep = true;
    private _bodyBuffer = 0;
    private _bodyBufferDirty = true;
    private _profilingEnabled = false;
    private readonly _performanceStats: HavokPerformanceStats = {
        stepMilliseconds: 0,
        transformSyncMilliseconds: 0,
        synchronizedBodies: 0,
        skippedBodies: 0,
        wasmMemoryBytes: 0,
    };
    private _defaultMaterial: PhysicsMaterial | null = null;
    private readonly _queryStart: HavokVector3 = [0, 0, 0];
    private readonly _queryEnd: HavokVector3 = [0, 0, 0];
    private readonly _queryRotation: HavokQuaternion = [0, 0, 0, 1];
    private readonly _queryPoint = new Vec3();
    private readonly _queryNormal = new Vec3();
    private readonly _ignoredBody: HavokBodyId = [HAVOK_ZERO_ID];
    private readonly _emptyShape: HavokShapeId = [HAVOK_ZERO_ID];
    private readonly _queryFilter: HavokFilterInfo = [0xffffffff, 0xffffffff];
    private readonly _rayCastInput: HavokRayCastInput = [
        this._queryStart, this._queryEnd, this._queryFilter, false, this._ignoredBody,
    ];
    private readonly _shapeCastInput: HavokShapeCastInput = [
        this._emptyShape, this._queryRotation, this._queryStart, this._queryEnd, false, this._ignoredBody,
    ];
    private readonly _shapeProximityInput: HavokShapeProximityInput = [
        this._emptyShape, this._queryStart, this._queryRotation, 0, false, this._ignoredBody,
    ];
    private readonly _singleIgnoredBody: RigidBody[] = [];
    private readonly _activeTriggers = new Map<string, [HavokShape, HavokShape]>();
    private readonly _enteredTriggers = new Set<string>();
    private readonly _exitedTriggers = new Set<string>();
    private readonly _contact = new HavokContact();
    private readonly _collisionEvent = {
        type: 'onCollisionEnter' as CollisionEventType,
        selfCollider: null as unknown as Collider,
        otherCollider: null as unknown as Collider,
        contacts: [] as ICollisionEvent['contacts'],
        impl: null as unknown,
    };
    private readonly _triggerEvent = {
        type: 'onTriggerEnter' as TriggerEventType,
        selfCollider: null as unknown as Collider,
        otherCollider: null as unknown as Collider,
        impl: null as unknown,
    };

    constructor (instance: HavokModule = havokLoader.instance) {
        this._instance = instance;
        const [worldResult, world] = instance.HP_World_Create();
        assertHavokResult(instance, worldResult, 'HP_World_Create');
        this._world = world;

        const [collectorResult, collector] = instance.HP_QueryCollector_Create(QUERY_COLLECTOR_CAPACITY);
        try {
            assertHavokResult(instance, collectorResult, 'HP_QueryCollector_Create');
            this._queryCollector = collector;
        } catch (error) {
            instance.HP_World_Release(world);
            this._world = null;
            throw error;
        }
    }

    get queryCollector (): HavokCollectorId {
        if (!this._queryCollector) throw new Error('[havok]: world is destroyed.');
        return this._queryCollector;
    }

    get allowSleep (): boolean {
        return this._allowSleep;
    }

    get defaultMaterial (): PhysicsMaterial | null {
        return this._defaultMaterial;
    }

    get performanceStats (): Readonly<HavokPerformanceStats> { return this._performanceStats; }

    setProfilingEnabled (value: boolean): void { this._profilingEnabled = value; }

    setGravity (value: IVec3Like): void {
        const world = this._getWorld();
        toHavokVector3(value, this._gravity);
        assertHavokResult(this._instance, this._instance.HP_World_SetGravity(world, this._gravity), 'HP_World_SetGravity');
    }

    setAllowSleep (value: boolean): void {
        this._allowSleep = value;
    }

    setDefaultMaterial (value: PhysicsMaterial): void {
        this._defaultMaterial = value;
    }

    addBody (owner: object, body: IHavokBodySync, startAsleep = false): void {
        const world = this._getWorld();
        if (this.bodyRegistry.hasOwner(owner) || this.bodyRegistry.getValue(body.bodyId)) {
            throw new Error('[havok]: body is already added to this world.');
        }
        assertHavokResult(
            this._instance,
            this._instance.HP_World_AddBody(world, body.bodyId, startAsleep),
            'HP_World_AddBody',
        );
        this.bodyRegistry.register(owner, body.bodyId, body);
        this._bodies.push(body);
        this._bodyBufferDirty = true;
    }

    removeBody (owner: object): void {
        const handle = this.bodyRegistry.getHandle(owner);
        if (!handle) return;
        const body = this.bodyRegistry.getValue(handle);
        assertHavokResult(this._instance, this._instance.HP_World_RemoveBody(this._getWorld(), handle), 'HP_World_RemoveBody');
        this.bodyRegistry.unregisterOwner(owner);
        if (body) {
            const index = this._bodies.indexOf(body);
            if (index >= 0) this._bodies.splice(index, 1);
        }
        this._bodyBufferDirty = true;
    }

    step (fixedTimeStep: number): void {
        const world = this._getWorld();
        if (fixedTimeStep !== this._idealStepTime) {
            assertHavokResult(
                this._instance,
                this._instance.HP_World_SetIdealStepTime(world, fixedTimeStep),
                'HP_World_SetIdealStepTime',
            );
            this._idealStepTime = fixedTimeStep;
        }
        for (let i = 0; i < this._bodies.length; i++) this._bodies[i].beforeStep?.(fixedTimeStep);
        const stepStart = this._profilingEnabled ? nowMilliseconds() : 0;
        assertHavokResult(this._instance, this._instance.HP_World_Step(world, fixedTimeStep), 'HP_World_Step');
        if (this._profilingEnabled) this._performanceStats.stepMilliseconds = nowMilliseconds() - stepStart;
        for (let i = 0; i < this._bodies.length; i++) this._bodies[i].afterStep?.();
        this._refreshBodyBuffer();
        const syncStart = this._profilingEnabled ? nowMilliseconds() : 0;
        let synchronized = 0;
        for (let i = 0; i < this._bodies.length; i++) {
            if (this._bodies[i].syncPhysicsToScene(this._bodyBuffer) === true) synchronized++;
        }
        if (this._profilingEnabled) {
            this._performanceStats.transformSyncMilliseconds = nowMilliseconds() - syncStart;
            this._performanceStats.synchronizedBodies = synchronized;
            this._performanceStats.skippedBodies = this._bodies.length - synchronized;
            this._performanceStats.wasmMemoryBytes = this._instance.HEAPU8.byteLength;
        }
    }

    syncSceneToPhysics (): void {
        for (let i = 0; i < this._bodies.length; i++) {
            this._bodies[i].syncSceneToPhysics();
        }
    }

    syncAfterEvents (): void {
        // Event callbacks are synchronized on the next regular pre-step pass.
    }

    getSharedBody (node: Node, wrappedBody?: HavokRigidBody): HavokSharedBody {
        return HavokSharedBody.get(node, this, wrappedBody);
    }

    emitEvents (): void {
        this._emitCollisionEvents();
        this._emitTriggerEvents();
    }

    raycast (
        worldRay: geometry.Ray,
        options: IRaycastOptions,
        pool: RecyclePool<PhysicsRayResult>,
        results: PhysicsRayResult[],
    ): boolean {
        this._writeRay(worldRay, options.maxDistance);
        this._prepareRayCastInput(options.group, options.mask, options.queryTrigger, this._ignoredBody);
        assertHavokResult(this._instance, this._instance.HP_World_CastRayWithCollector(this._getWorld(), this.queryCollector, this._rayCastInput), 'HP_World_CastRayWithCollector');
        const count = this._getQueryHitCount();
        let added = 0;
        for (let i = 0; i < count; i++) {
            const [result, hit] = this._instance.HP_QueryCollector_GetCastRayResult(this.queryCollector, i);
            assertHavokResult(this._instance, result, 'HP_QueryCollector_GetCastRayResult');
            const rayResult = pool.add();
            if (this._assignQueryHit(hit[1], hit[0], options.maxDistance, rayResult)) { results.push(rayResult); added++; }
        }
        return added > 0;
    }

    raycastClosest (worldRay: geometry.Ray, options: IRaycastOptions, out: PhysicsRayResult): boolean {
        this._writeRay(worldRay, options.maxDistance);
        this._prepareRayCastInput(options.group, options.mask, options.queryTrigger, this._ignoredBody);
        assertHavokResult(this._instance, this._instance.HP_World_CastRayWithCollector(this._getWorld(), this.queryCollector, this._rayCastInput), 'HP_World_CastRayWithCollector');
        if (this._getQueryHitCount() === 0) return false;
        const [result, hit] = this._instance.HP_QueryCollector_GetCastRayResult(this.queryCollector, 0);
        assertHavokResult(this._instance, result, 'HP_QueryCollector_GetCastRayResult');
        return this._assignQueryHit(hit[1], hit[0], options.maxDistance, out);
    }

    raycastClosestIgnoringBody (
        worldRay: geometry.Ray,
        mask: number,
        maxDistance: number,
        queryTrigger: boolean,
        ignoredBody: RigidBody,
        out: PhysicsRayResult,
    ): boolean {
        this._singleIgnoredBody[0] = ignoredBody;
        return this.raycastClosestIgnoringBodies(worldRay, mask, maxDistance, queryTrigger, this._singleIgnoredBody, out);
    }

    raycastClosestIgnoringBodies (
        worldRay: geometry.Ray,
        mask: number,
        maxDistance: number,
        queryTrigger: boolean,
        ignoredBodies: readonly RigidBody[],
        out: PhysicsRayResult,
    ): boolean {
        this._writeRay(worldRay, maxDistance);
        const body = ignoredBodies[0]?.body as HavokRigidBody | null;
        const ignored = body?.impl ?? this._ignoredBody;
        this._prepareRayCastInput(0xffffffff, mask, queryTrigger, ignored);
        assertHavokResult(
            this._instance,
            this._instance.HP_World_CastRayWithCollector(this._getWorld(), this.queryCollector, this._rayCastInput),
            'HP_World_CastRayWithCollector',
        );
        const hitCount = this._getQueryHitCount();
        for (let i = 0; i < hitCount; i++) {
            const [result, hit] = this._instance.HP_QueryCollector_GetCastRayResult(this.queryCollector, i);
            assertHavokResult(this._instance, result, 'HP_QueryCollector_GetCastRayResult');
            let isIgnored = false;
            for (let j = 1; j < ignoredBodies.length; j++) {
                const ignoredBackend = ignoredBodies[j].body as HavokRigidBody | null;
                if (ignoredBackend?.impl[0] === hit[1][0][0]) { isIgnored = true; break; }
            }
            if (!isIgnored && this._assignQueryHit(hit[1], hit[0], maxDistance, out)) return true;
        }
        return false;
    }

    sweepBox (
        worldRay: geometry.Ray,
        halfExtent: IVec3Like,
        orientation: IQuatLike,
        options: IRaycastOptions,
        pool: RecyclePool<PhysicsRayResult>,
        results: PhysicsRayResult[],
    ): boolean {
        const [result, shape] = this._instance.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], [halfExtent.x * 2, halfExtent.y * 2, halfExtent.z * 2]);
        assertHavokResult(this._instance, result, 'HP_Shape_CreateBox');
        return this._shapeCast(shape, worldRay, orientation, options, pool, results, false);
    }

    sweepBoxClosest (
        worldRay: geometry.Ray,
        halfExtent: IVec3Like,
        orientation: IQuatLike,
        options: IRaycastOptions,
        out: PhysicsRayResult,
    ): boolean {
        const [result, shape] = this._instance.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], [halfExtent.x * 2, halfExtent.y * 2, halfExtent.z * 2]);
        assertHavokResult(this._instance, result, 'HP_Shape_CreateBox');
        return this._shapeCast(shape, worldRay, orientation, options, null, null, true, out);
    }

    sweepSphere (
        worldRay: geometry.Ray,
        radius: number,
        options: IRaycastOptions,
        pool: RecyclePool<PhysicsRayResult>,
        results: PhysicsRayResult[],
    ): boolean {
        const [result, shape] = this._instance.HP_Shape_CreateSphere([0, 0, 0], radius);
        assertHavokResult(this._instance, result, 'HP_Shape_CreateSphere');
        return this._shapeCast(shape, worldRay, { x: 0, y: 0, z: 0, w: 1 }, options, pool, results, false);
    }

    sweepSphereClosest (
        worldRay: geometry.Ray,
        radius: number,
        options: IRaycastOptions,
        out: PhysicsRayResult,
    ): boolean {
        const [result, shape] = this._instance.HP_Shape_CreateSphere([0, 0, 0], radius);
        assertHavokResult(this._instance, result, 'HP_Shape_CreateSphere');
        return this._shapeCast(shape, worldRay, { x: 0, y: 0, z: 0, w: 1 }, options, null, null, true, out);
    }

    sweepCapsule (
        worldRay: geometry.Ray,
        radius: number,
        height: number,
        orientation: IQuatLike,
        options: IRaycastOptions,
        pool: RecyclePool<PhysicsRayResult>,
        results: PhysicsRayResult[],
    ): boolean {
        const [result, shape] = this._instance.HP_Shape_CreateCapsule([0, -height * 0.5, 0], [0, height * 0.5, 0], radius);
        assertHavokResult(this._instance, result, 'HP_Shape_CreateCapsule');
        return this._shapeCast(shape, worldRay, orientation, options, pool, results, false);
    }

    sweepCapsuleClosest (
        worldRay: geometry.Ray,
        radius: number,
        height: number,
        orientation: IQuatLike,
        options: IRaycastOptions,
        out: PhysicsRayResult,
    ): boolean {
        const [result, shape] = this._instance.HP_Shape_CreateCapsule([0, -height * 0.5, 0], [0, height * 0.5, 0], radius);
        assertHavokResult(this._instance, result, 'HP_Shape_CreateCapsule');
        return this._shapeCast(shape, worldRay, orientation, options, null, null, true, out);
    }

    destroy (): void {
        if (!this._world) return;
        let failure: unknown;
        for (let i = 0; i < this._bodies.length; i++) {
            try {
                assertHavokResult(
                    this._instance,
                    this._instance.HP_World_RemoveBody(this._world, this._bodies[i].bodyId),
                    'HP_World_RemoveBody',
                );
            } catch (error) {
                if (!failure) failure = error;
            }
        }
        this._bodies.length = 0;
        this.bodyRegistry.clear();
        this.shapeRegistry.clear();
        this._activeTriggers.clear();

        if (this._queryCollector) {
            try {
                assertHavokResult(
                    this._instance,
                    this._instance.HP_QueryCollector_Release(this._queryCollector),
                    'HP_QueryCollector_Release',
                );
            } catch (error) {
                if (!failure) failure = error;
            }
            this._queryCollector = null;
        }

        try {
            assertHavokResult(this._instance, this._instance.HP_World_Release(this._world), 'HP_World_Release');
        } catch (error) {
            if (!failure) failure = error;
        }
        this._world = null;
        this._bodyBuffer = 0;
        if (failure) throw failure;
    }

    private _getWorld (): HavokWorldId {
        if (!this._world) throw new Error('[havok]: world is destroyed.');
        return this._world;
    }

    private _refreshBodyBuffer (): void {
        if (!this._bodyBufferDirty) return;
        const [result, buffer] = this._instance.HP_World_GetBodyBuffer(this._getWorld());
        assertHavokResult(this._instance, result, 'HP_World_GetBodyBuffer');
        this._bodyBuffer = buffer;
        for (let i = 0; i < this._bodies.length; i++) this._bodies[i].refreshTransformOffset?.();
        this._bodyBufferDirty = false;
    }

    registerShape (shape: HavokShape): void { if (shape.impl) this.shapeRegistry.register(shape, shape.impl, shape); }
    unregisterShape (shape: HavokShape): void { this.shapeRegistry.unregisterOwner(shape); }

    queryShapeProximity (
        shape: HavokShapeId,
        position: IVec3Like,
        orientation: IQuatLike,
        maxDistance: number,
        queryTrigger: boolean,
    ): HavokProximityHit[] {
        this._queryStart[0] = position.x; this._queryStart[1] = position.y; this._queryStart[2] = position.z;
        this._queryRotation[0] = orientation.x; this._queryRotation[1] = orientation.y;
        this._queryRotation[2] = orientation.z; this._queryRotation[3] = orientation.w;
        this._prepareShapeProximityInput(shape, maxDistance, queryTrigger);
        assertHavokResult(
            this._instance,
            this._instance.HP_World_ShapeProximityWithCollector(this._getWorld(), this.queryCollector, this._shapeProximityInput),
            'HP_World_ShapeProximityWithCollector',
        );
        const count = this._getQueryHitCount(); const hits: HavokProximityHit[] = [];
        for (let i = 0; i < count; i++) {
            const [result, hit] = this._instance.HP_QueryCollector_GetShapeProximityResult(this.queryCollector, i);
            assertHavokResult(this._instance, result, 'HP_QueryCollector_GetShapeProximityResult');
            const contact = hit[2]; const target = this._shapeFromContact(contact);
            if (!target) continue;
            hits.push({
                collider: target.collider,
                point: new Vec3(contact[3][0], contact[3][1], contact[3][2]),
                normal: new Vec3(contact[4][0], contact[4][1], contact[4][2]),
                distance: hit[0],
                triangleIndex: contact[5],
            });
        }
        return hits;
    }

    queryShapeProximityColliders (
        shape: HavokShapeId,
        position: IVec3Like,
        orientation: IQuatLike,
        queryTrigger: boolean,
        out: Collider[],
    ): number {
        out.length = 0;
        this._queryStart[0] = position.x; this._queryStart[1] = position.y; this._queryStart[2] = position.z;
        this._queryRotation[0] = orientation.x; this._queryRotation[1] = orientation.y;
        this._queryRotation[2] = orientation.z; this._queryRotation[3] = orientation.w;
        this._prepareShapeProximityInput(shape, 0, queryTrigger);
        assertHavokResult(
            this._instance,
            this._instance.HP_World_ShapeProximityWithCollector(this._getWorld(), this.queryCollector, this._shapeProximityInput),
            'HP_World_ShapeProximityWithCollector',
        );
        const count = this._getQueryHitCount();
        for (let i = 0; i < count; i++) {
            const [result, hit] = this._instance.HP_QueryCollector_GetShapeProximityResult(this.queryCollector, i);
            assertHavokResult(this._instance, result, 'HP_QueryCollector_GetShapeProximityResult');
            const target = this._shapeFromContact(hit[2]);
            if (target && out.indexOf(target.collider) < 0) out.push(target.collider);
        }
        return out.length;
    }

    private _writeRay (ray: geometry.Ray, distance: number): void {
        this._queryStart[0] = ray.o.x; this._queryStart[1] = ray.o.y; this._queryStart[2] = ray.o.z;
        this._queryEnd[0] = ray.o.x + ray.d.x * distance;
        this._queryEnd[1] = ray.o.y + ray.d.y * distance;
        this._queryEnd[2] = ray.o.z + ray.d.z * distance;
    }
    private _prepareRayCastInput (group: number, mask: number, queryTrigger: boolean, ignoredBody: HavokBodyId): void {
        this._queryFilter[0] = group >>> 0;
        this._queryFilter[1] = mask >>> 0;
        this._rayCastInput[3] = queryTrigger;
        this._rayCastInput[4] = ignoredBody;
    }
    private _prepareShapeProximityInput (shape: HavokShapeId, distance: number, queryTrigger: boolean): void {
        this._shapeProximityInput[0] = shape;
        this._shapeProximityInput[3] = distance;
        this._shapeProximityInput[4] = queryTrigger;
    }
    private _getQueryHitCount (): number {
        const [result, count] = this._instance.HP_QueryCollector_GetNumHits(this.queryCollector);
        assertHavokResult(this._instance, result, 'HP_QueryCollector_GetNumHits');
        return count;
    }
    private _assignQueryHit (contact: HavokContactPoint, fraction: number, maxDistance: number, out: PhysicsRayResult): boolean {
        const shape = this._shapeFromContact(contact);
        if (!shape) return false;
        this._queryPoint.set(contact[3][0], contact[3][1], contact[3][2]);
        this._queryNormal.set(contact[4][0], contact[4][1], contact[4][2]);
        out._assign(this._queryPoint, fraction * maxDistance, shape.collider, this._queryNormal, fraction);
        return true;
    }
    private _shapeCast (
        shape: HavokShapeId,
        ray: geometry.Ray,
        orientation: IQuatLike,
        options: IRaycastOptions,
        pool: RecyclePool<PhysicsRayResult> | null,
        results: PhysicsRayResult[] | null,
        closest: boolean,
        out?: PhysicsRayResult,
    ): boolean {
        try {
            assertHavokResult(this._instance, this._instance.HP_Shape_SetFilterInfo(shape, [options.group >>> 0, options.mask >>> 0]), 'HP_Shape_SetFilterInfo');
            this._writeRay(ray, options.maxDistance);
            this._queryRotation[0] = orientation.x; this._queryRotation[1] = orientation.y;
            this._queryRotation[2] = orientation.z; this._queryRotation[3] = orientation.w;
            this._shapeCastInput[0] = shape;
            this._shapeCastInput[4] = options.queryTrigger;
            assertHavokResult(this._instance, this._instance.HP_World_ShapeCastWithCollector(this._getWorld(), this.queryCollector, this._shapeCastInput), 'HP_World_ShapeCastWithCollector');
            const count = this._getQueryHitCount();
            if (count === 0) return false;
            const limit = closest ? 1 : count; let added = 0;
            for (let i = 0; i < limit; i++) {
                const [result, hit] = this._instance.HP_QueryCollector_GetShapeCastResult(this.queryCollector, i);
                assertHavokResult(this._instance, result, 'HP_QueryCollector_GetShapeCastResult');
                const target = closest ? out! : pool!.add();
                if (this._assignQueryHit(hit[2], hit[0], options.maxDistance, target)) {
                    if (!closest) results!.push(target);
                    added++;
                }
            }
            return added > 0;
        } finally {
            assertHavokResult(this._instance, this._instance.HP_Shape_Release(shape), 'HP_Shape_Release');
        }
    }
    private _emitCollisionEvents (): void {
        const [result, first] = this._instance.HP_World_GetCollisionEvents(this._getWorld());
        if (!isHavokResultOk(this._instance, result)) return;
        for (let eventId = first; eventId; eventId = this._instance.HP_World_GetNextCollisionEvent(this._getWorld(), eventId)) {
            const [eventResult, event] = this._instance.HP_Event_AsCollision(eventId);
            assertHavokResult(this._instance, eventResult, 'HP_Event_AsCollision');
            const shapeA = this._shapeFromContact(event[1]); const shapeB = this._shapeFromContact(event[2]);
            if (!shapeA || !shapeB) continue;
            const type: CollisionEventType = event[0] === this._instance.EventType.COLLISION_STARTED
                ? 'onCollisionEnter' : event[0] === this._instance.EventType.COLLISION_FINISHED ? 'onCollisionExit' : 'onCollisionStay';
            this._collisionEvent.type = type; this._collisionEvent.impl = event;
            this._contact.impl = event; this._contact.event = this._collisionEvent;
            this._contact.shapeA = shapeA.collider; this._contact.shapeB = shapeB.collider;
            this._collisionEvent.contacts.length = type === 'onCollisionExit' ? 0 : 1;
            if (type !== 'onCollisionExit') this._collisionEvent.contacts[0] = this._contact;
            this._emitCollisionTo(shapeA.collider, shapeB.collider, type);
            this._emitCollisionTo(shapeB.collider, shapeA.collider, type);
        }
    }
    private _emitCollisionTo (self: Collider, other: Collider, type: CollisionEventType): void {
        if (!self.needCollisionEvent) return;
        this._collisionEvent.selfCollider = self; this._collisionEvent.otherCollider = other;
        self.emit(type, this._collisionEvent);
    }
    private _emitTriggerEvents (): void {
        const entered = this._enteredTriggers; const exited = this._exitedTriggers;
        entered.clear(); exited.clear();
        const [result, first] = this._instance.HP_World_GetTriggerEvents(this._getWorld());
        if (!isHavokResultOk(this._instance, result)) {
            this._activeTriggers.forEach(([shapeA, shapeB]): void => this._emitTriggerPair(shapeA, shapeB, 'onTriggerStay', null));
            return;
        }
        for (let eventId = first; eventId; eventId = this._instance.HP_World_GetNextTriggerEvent(this._getWorld(), eventId)) {
            const [eventResult, event] = this._instance.HP_Event_AsTrigger(eventId);
            assertHavokResult(this._instance, eventResult, 'HP_Event_AsTrigger');
            const shapeA = this.shapeRegistry.getValue(event[2]); const shapeB = this.shapeRegistry.getValue(event[4]);
            if (!shapeA || !shapeB) continue;
            const key = this._pairKey(event[2], event[4]);
            if (event[0] === this._instance.EventType.TRIGGER_ENTERED) {
                if (!this._activeTriggers.has(key)) { this._activeTriggers.set(key, [shapeA, shapeB]); entered.add(key); this._emitTriggerPair(shapeA, shapeB, 'onTriggerEnter', event); }
            } else if (this._activeTriggers.delete(key)) { exited.add(key); this._emitTriggerPair(shapeA, shapeB, 'onTriggerExit', event); }
        }
        this._activeTriggers.forEach(([shapeA, shapeB], key): void => {
            if (!entered.has(key) && !exited.has(key)) this._emitTriggerPair(shapeA, shapeB, 'onTriggerStay', null);
        });
    }
    private _emitTriggerPair (shapeA: HavokShape, shapeB: HavokShape, type: TriggerEventType, impl: unknown): void {
        this._triggerEvent.type = type; this._triggerEvent.impl = impl;
        if (shapeA.collider.needTriggerEvent) { this._triggerEvent.selfCollider = shapeA.collider; this._triggerEvent.otherCollider = shapeB.collider; shapeA.collider.emit(type, this._triggerEvent); }
        if (shapeB.collider.needTriggerEvent) { this._triggerEvent.selfCollider = shapeB.collider; this._triggerEvent.otherCollider = shapeA.collider; shapeB.collider.emit(type, this._triggerEvent); }
    }
    private _pairKey (a: HavokShapeId, b: HavokShapeId): string {
        const av = a[0]; const bv = b[0]; return av < bv ? `${av}:${bv}` : `${bv}:${av}`;
    }
    private _shapeFromContact (contact: HavokContactPoint): HavokShape | undefined {
        return this.shapeRegistry.getValue(contact[1]) || this.shapeRegistry.getValue([contact[2][0]]);
    }
}

function nowMilliseconds (): number {
    return typeof performance === 'undefined' ? Date.now() : performance.now();
}
