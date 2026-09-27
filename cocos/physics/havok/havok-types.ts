/*
 Copyright (c) 2026 KropAl-Playable
 SPDX-License-Identifier: MIT
 */

export type HavokResult = number | { readonly value: number };
export type HavokWorldId = [bigint];
export type HavokBodyId = [bigint];
export type HavokShapeId = [bigint];
export type HavokConstraintId = [bigint];
export type HavokCollectorId = [bigint];
export type HavokVector3 = [number, number, number];
export type HavokQuaternion = [number, number, number, number];
export type HavokQTransform = [HavokVector3, HavokQuaternion];
export type HavokQSTransform = [HavokVector3, HavokQuaternion, HavokVector3];
export type HavokMassProperties = [HavokVector3, number, HavokVector3, HavokQuaternion];
export type HavokPhysicsMaterial = [number, number, number, number, number];
export type HavokFilterInfo = [number, number];
export type HavokAabb = [HavokVector3, HavokVector3];
export type HavokShapePath = [bigint, bigint];
export type HavokContactPoint = [HavokBodyId, HavokShapeId, HavokShapePath, HavokVector3, HavokVector3, number];
export type HavokRayCastInput = [HavokVector3, HavokVector3, HavokFilterInfo, boolean, HavokBodyId];
export type HavokRayCastResult = [number, HavokContactPoint];
export type HavokShapeCastInput = [HavokShapeId, HavokQuaternion, HavokVector3, HavokVector3, boolean, HavokBodyId];
export type HavokShapeCastResult = [number, HavokContactPoint, HavokContactPoint];
export type HavokShapeProximityInput = [HavokShapeId, HavokVector3, HavokQuaternion, number, boolean, HavokBodyId];
export type HavokShapeProximityResult = [number, HavokContactPoint, HavokContactPoint];
export type HavokCollisionEvent = [number, HavokContactPoint, HavokContactPoint, number];
export type HavokTriggerEvent = [number, HavokBodyId, HavokShapeId, HavokBodyId, HavokShapeId];

export type HavokHandle = HavokWorldId | HavokBodyId | HavokShapeId | HavokConstraintId | HavokCollectorId;

export interface HavokModule {
    readonly Result: {
        readonly RESULT_OK: HavokResult;
    };
    readonly MotionType: {
        readonly STATIC: number;
        readonly KINEMATIC: number;
        readonly DYNAMIC: number;
    };
    readonly ActivationState: {
        readonly ACTIVE: number;
        readonly INACTIVE: number;
    };
    readonly ActivationControl: {
        readonly SIMULATION_CONTROLLED: number;
        readonly ALWAYS_ACTIVE: number;
        readonly ALWAYS_INACTIVE: number;
    };
    readonly EventType: {
        readonly COLLISION_STARTED: number;
        readonly COLLISION_CONTINUED: number;
        readonly COLLISION_FINISHED: number;
        readonly TRIGGER_ENTERED: number;
        readonly TRIGGER_EXITED: number;
    };
    readonly ConstraintAxis: {
        readonly LINEAR_X: number;
        readonly LINEAR_Y: number;
        readonly LINEAR_Z: number;
        readonly ANGULAR_X: number;
        readonly ANGULAR_Y: number;
        readonly ANGULAR_Z: number;
        readonly LINEAR_DISTANCE: number;
    };
    readonly ConstraintAxisLimitMode: { readonly FREE: number; readonly LIMITED: number; readonly LOCKED: number };
    readonly ConstraintMotorType: {
        readonly NONE: number;
        readonly VELOCITY: number;
        readonly POSITION: number;
        readonly SPRING_FORCE: number;
        readonly SPRING_ACCELERATION: number;
    };
    readonly MaterialCombine: {
        readonly GEOMETRIC_MEAN: number;
    };
    readonly HEAPF32: Float32Array;
    readonly HEAPU8: Uint8Array;
    readonly HEAPU32: Uint32Array;
    _malloc (size: number): number;
    _free (address: number): void;
    HP_World_Create (): [HavokResult, HavokWorldId];
    HP_World_Release (world: HavokWorldId): HavokResult;
    HP_World_SetGravity (world: HavokWorldId, gravity: HavokVector3): HavokResult;
    HP_World_AddBody (world: HavokWorldId, body: HavokBodyId, startAsleep: boolean): HavokResult;
    HP_World_RemoveBody (world: HavokWorldId, body: HavokBodyId): HavokResult;
    HP_World_Step (world: HavokWorldId, timestep: number): HavokResult;
    HP_World_SetIdealStepTime (world: HavokWorldId, timestep: number): HavokResult;
    HP_World_GetBodyBuffer (world: HavokWorldId): [HavokResult, number];
    HP_World_GetCollisionEvents (world: HavokWorldId): [HavokResult, number];
    HP_World_GetNextCollisionEvent (world: HavokWorldId, previousEvent: number): number;
    HP_Event_AsCollision (eventId: number): [HavokResult, HavokCollisionEvent];
    HP_World_GetTriggerEvents (world: HavokWorldId): [HavokResult, number];
    HP_World_GetNextTriggerEvent (world: HavokWorldId, previousEvent: number): number;
    HP_Event_AsTrigger (eventId: number): [HavokResult, HavokTriggerEvent];
    HP_World_CastRayWithCollector (world: HavokWorldId, collector: HavokCollectorId, input: HavokRayCastInput): HavokResult;
    HP_World_ShapeCastWithCollector (world: HavokWorldId, collector: HavokCollectorId, input: HavokShapeCastInput): HavokResult;
    HP_World_ShapeProximityWithCollector (world: HavokWorldId, collector: HavokCollectorId, input: HavokShapeProximityInput): HavokResult;
    HP_Body_Create (): [HavokResult, HavokBodyId];
    HP_Body_Release (body: HavokBodyId): HavokResult;
    HP_Body_SetShape (body: HavokBodyId, shape: HavokShapeId): HavokResult;
    HP_Body_SetMotionType (body: HavokBodyId, motionType: number): HavokResult;
    HP_Body_SetMassProperties (body: HavokBodyId, massProperties: HavokMassProperties): HavokResult;
    HP_Body_GetMassProperties (body: HavokBodyId): [HavokResult, HavokMassProperties];
    HP_Body_SetLinearDamping (body: HavokBodyId, damping: number): HavokResult;
    HP_Body_SetAngularDamping (body: HavokBodyId, damping: number): HavokResult;
    HP_Body_SetGravityFactor (body: HavokBodyId, factor: number): HavokResult;
    HP_Body_GetWorldTransformOffset (body: HavokBodyId): [HavokResult, number];
    HP_Body_SetQTransform (body: HavokBodyId, transform: HavokQTransform): HavokResult;
    HP_Body_GetQTransform (body: HavokBodyId): [HavokResult, HavokQTransform];
    HP_Body_SetTargetQTransform (body: HavokBodyId, transform: HavokQTransform): HavokResult;
    HP_Body_SetLinearVelocity (body: HavokBodyId, velocity: HavokVector3): HavokResult;
    HP_Body_GetLinearVelocity (body: HavokBodyId): [HavokResult, HavokVector3];
    HP_Body_SetAngularVelocity (body: HavokBodyId, velocity: HavokVector3): HavokResult;
    HP_Body_GetAngularVelocity (body: HavokBodyId): [HavokResult, HavokVector3];
    HP_Body_ApplyImpulse (body: HavokBodyId, location: HavokVector3, impulse: HavokVector3): HavokResult;
    HP_Body_ApplyAngularImpulse (body: HavokBodyId, impulse: HavokVector3): HavokResult;
    HP_Body_SetActivationState (body: HavokBodyId, state: number): HavokResult;
    HP_Body_GetActivationState (body: HavokBodyId): [HavokResult, number];
    HP_Body_SetActivationControl (body: HavokBodyId, control: number): HavokResult;
    HP_Body_SetActivationPriority (body: HavokBodyId, priority: number): HavokResult;
    HP_Body_SetEventMask (body: HavokBodyId, eventMask: number): HavokResult;
    HP_Shape_CreateSphere (center: HavokVector3, radius: number): [HavokResult, HavokShapeId];
    HP_Shape_CreateCapsule (pointA: HavokVector3, pointB: HavokVector3, radius: number): [HavokResult, HavokShapeId];
    HP_Shape_CreateCylinder (pointA: HavokVector3, pointB: HavokVector3, radius: number): [HavokResult, HavokShapeId];
    HP_Shape_CreateBox (center: HavokVector3, rotation: HavokQuaternion, extents: HavokVector3): [HavokResult, HavokShapeId];
    HP_Shape_CreateConvexHull (vertices: number, vertexCount: number): [HavokResult, HavokShapeId];
    HP_Shape_CreateMesh (vertices: number, vertexCount: number, triangles: number, triangleCount: number): [HavokResult, HavokShapeId];
    HP_Shape_CreateContainer (): [HavokResult, HavokShapeId];
    HP_Shape_AddChild (container: HavokShapeId, child: HavokShapeId, transform: HavokQSTransform): HavokResult;
    HP_Shape_RemoveChild (container: HavokShapeId, childIndex: number): HavokResult;
    HP_Shape_SetFilterInfo (shape: HavokShapeId, filter: HavokFilterInfo): HavokResult;
    HP_Shape_SetMaterial (shape: HavokShapeId, material: HavokPhysicsMaterial): HavokResult;
    HP_Shape_SetDensity (shape: HavokShapeId, density: number): HavokResult;
    HP_Shape_SetTrigger (shape: HavokShapeId, trigger: boolean): HavokResult;
    HP_Shape_GetBoundingBox (shape: HavokShapeId, transform: HavokQTransform): [HavokResult, HavokAabb];
    HP_Shape_BuildMassProperties (shape: HavokShapeId): [HavokResult, HavokMassProperties];
    HP_Shape_Release (shape: HavokShapeId): HavokResult;
    HP_QueryCollector_Create (hitCapacity: number): [HavokResult, HavokCollectorId];
    HP_QueryCollector_Release (collector: HavokCollectorId): HavokResult;
    HP_QueryCollector_GetNumHits (collector: HavokCollectorId): [HavokResult, number];
    HP_QueryCollector_GetCastRayResult (collector: HavokCollectorId, hitIndex: number): [HavokResult, HavokRayCastResult];
    HP_QueryCollector_GetShapeCastResult (collector: HavokCollectorId, hitIndex: number): [HavokResult, HavokShapeCastResult];
    HP_QueryCollector_GetShapeProximityResult (collector: HavokCollectorId, hitIndex: number): [HavokResult, HavokShapeProximityResult];
    HP_Constraint_Create (): [HavokResult, HavokConstraintId];
    HP_Constraint_Release (constraint: HavokConstraintId): HavokResult;
    HP_Constraint_SetParentBody (constraint: HavokConstraintId, body: HavokBodyId): HavokResult;
    HP_Constraint_SetChildBody (constraint: HavokConstraintId, body: HavokBodyId): HavokResult;
    HP_Constraint_SetAnchorInParent (constraint: HavokConstraintId, pivot: HavokVector3, axisX: HavokVector3, axisY: HavokVector3): HavokResult;
    HP_Constraint_SetAnchorInChild (constraint: HavokConstraintId, pivot: HavokVector3, axisX: HavokVector3, axisY: HavokVector3): HavokResult;
    HP_Constraint_SetEnabled (constraint: HavokConstraintId, enabled: number): HavokResult;
    HP_Constraint_SetCollisionsEnabled (constraint: HavokConstraintId, enabled: number): HavokResult;
    HP_Constraint_SetAxisMode (constraint: HavokConstraintId, axis: number, mode: number): HavokResult;
    HP_Constraint_SetAxisFriction (constraint: HavokConstraintId, axis: number, value: number): HavokResult;
    HP_Constraint_SetAxisMinLimit (constraint: HavokConstraintId, axis: number, value: number): HavokResult;
    HP_Constraint_SetAxisMaxLimit (constraint: HavokConstraintId, axis: number, value: number): HavokResult;
    HP_Constraint_SetAxisStiffness (constraint: HavokConstraintId, axis: number, value: number): HavokResult;
    HP_Constraint_SetAxisDamping (constraint: HavokConstraintId, axis: number, value: number): HavokResult;
    HP_Constraint_SetAxisMotorType (constraint: HavokConstraintId, axis: number, type: number): HavokResult;
    HP_Constraint_SetAxisMotorPositionTarget (constraint: HavokConstraintId, axis: number, value: number): HavokResult;
    HP_Constraint_SetAxisMotorVelocityTarget (constraint: HavokConstraintId, axis: number, value: number): HavokResult;
    HP_Constraint_SetAxisMotorMaxForce (constraint: HavokConstraintId, axis: number, value: number): HavokResult;
    HP_Constraint_SetAxisMotorStiffness (constraint: HavokConstraintId, axis: number, value: number): HavokResult;
    HP_Constraint_SetAxisMotorDamping (constraint: HavokConstraintId, axis: number, value: number): HavokResult;
    HP_Constraint_GetAppliedImpulses (constraint: HavokConstraintId): [HavokResult, HavokVector3, HavokVector3];
}

export interface HavokFactoryOptions {
    instantiateWasm (
        importObject: WebAssembly.Imports,
        receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ): WebAssembly.Exports;
}

export type HavokEmscriptenFactory = (options: HavokFactoryOptions) => Promise<HavokModule>;
