/*
 Copyright (c) 2026 KropAl-Playable
 SPDX-License-Identifier: MIT
 */

import { IVec3Like, Quat, Vec3 } from '../../core';
import { ERigidBodyType, PhysicsSystem, RigidBody } from '../framework';
import type { IRigidBody } from '../spec/i-rigid-body';
import { HavokSharedBody } from './havok-shared-body';
import type { HavokBodyId, HavokConstraintId, HavokMassProperties, HavokModule, HavokResult, HavokVector3 } from './havok-types';
import { assertHavokResult, fromHavokVector3, toHavokVector3 } from './havok-util';
import type { HavokWorld } from './havok-world';

const MIN_MASS = 0.000001;
const HAVOK_ZERO_ID = (globalThis as unknown as { BigInt: (value: number) => bigint }).BigInt(0);
const HAVOK_FIXED_BODY: HavokBodyId = [HAVOK_ZERO_ID];

export class HavokRigidBody implements IRigidBody {
    get impl (): HavokBodyId { return this._sharedBody.bodyId; }
    get rigidBody (): RigidBody { return this._rigidBody; }
    get sharedBody (): HavokSharedBody { return this._sharedBody; }
    get isAwake (): boolean {
        const [result, state] = this._instance.HP_Body_GetActivationState(this.impl);
        assertHavokResult(this._instance, result, 'HP_Body_GetActivationState');
        return state === this._instance.ActivationState.ACTIVE;
    }
    get isSleepy (): boolean { return false; }
    get isSleeping (): boolean { return !this.isAwake; }

    private _rigidBody!: RigidBody;
    private _sharedBody!: HavokSharedBody;
    private _instance!: HavokModule;
    private _mass = 1;
    private _sleepThreshold = 0.1;
    private _usingCCD = false;
    private _allowSleep = true;
    private _automaticCenterOfMass = true;
    private readonly _centerOfMass = new Vec3();
    private _automaticInertiaTensor = true;
    private readonly _inertiaTensor = new Vec3(1, 1, 1);
    private readonly _inertiaTensorRotation = new Quat();
    private _maxLinearVelocity = 0;
    private _maxAngularVelocity = 0;
    private _axisLockConstraint: HavokConstraintId | null = null;
    private readonly _linearFactor = new Vec3(1, 1, 1);
    private readonly _angularFactor = new Vec3(1, 1, 1);
    private readonly _pendingForce = new Vec3();
    private readonly _pendingTorque = new Vec3();
    private readonly _v0: HavokVector3 = [0, 0, 0];
    private readonly _v1: HavokVector3 = [0, 0, 0];
    private readonly _temp0 = new Vec3();
    private readonly _temp1 = new Vec3();
    private readonly _lockPivotParent: HavokVector3 = [0, 0, 0];
    private readonly _lockPivotWorld: HavokVector3 = [0, 0, 0];
    private readonly _lockAxisXParent: HavokVector3 = [1, 0, 0];
    private readonly _lockAxisYParent: HavokVector3 = [0, 1, 0];
    private readonly _lockAxisXWorld: HavokVector3 = [1, 0, 0];
    private readonly _lockAxisYWorld: HavokVector3 = [0, 1, 0];

    initialize (component: RigidBody): void {
        this._rigidBody = component;
        const world = PhysicsSystem.instance.physicsWorld as HavokWorld;
        this._instance = world.instance;
        this._sharedBody = world.getSharedBody(component.node, this);
        this._sharedBody.reference = true;
        this._mass = component.mass;
    }

    onEnable (): void {
        this.setType(this._rigidBody.type);
        this.setMass(this._rigidBody.mass);
        this.setLinearDamping(this._rigidBody.linearDamping);
        this.setAngularDamping(this._rigidBody.angularDamping);
        this.useGravity(this._rigidBody.useGravity);
        this.setLinearFactor(this._rigidBody.linearFactor);
        this.setAngularFactor(this._rigidBody.angularFactor);
        this.setAllowSleep(this._rigidBody.allowSleep);
        this.wakeUp();
    }

    onDisable (): void { this.sleep(); }
    onDestroy (): void {
        this._destroyAxisLockConstraint();
        this._sharedBody.reference = false;
        (this._rigidBody as any) = null;
        (this._sharedBody as any) = null;
    }

    setType (value: ERigidBodyType): void {
        this._sharedBody.setType(value);
        this._rebuildAxisLockConstraint();
    }
    setMass (value: number): void { this._mass = Math.max(MIN_MASS, value); this.reapplyMassProperties(); }
    setLinearDamping (value: number): void { this._check(this._instance.HP_Body_SetLinearDamping(this.impl, value), 'HP_Body_SetLinearDamping'); }
    setAngularDamping (value: number): void { this._check(this._instance.HP_Body_SetAngularDamping(this.impl, value), 'HP_Body_SetAngularDamping'); }
    useGravity (value: boolean): void { this.setGravityScale(value ? 1 : 0); }
    setGravityScale (value: number): void {
        this._check(this._instance.HP_Body_SetGravityFactor(this.impl, value), 'HP_Body_SetGravityFactor');
    }
    setAutomaticCenterOfMass (value: boolean): void {
        this._automaticCenterOfMass = value;
        this.reapplyMassProperties();
    }
    setCenterOfMass (value: IVec3Like): void {
        Vec3.copy(this._centerOfMass, value);
        if (!this._automaticCenterOfMass) this.reapplyMassProperties();
    }
    setAutomaticInertiaTensor (value: boolean): void {
        this._automaticInertiaTensor = value;
        this.reapplyMassProperties();
    }
    setInertiaTensor (value: IVec3Like): void {
        this._inertiaTensor.set(
            Math.max(MIN_MASS, value.x),
            Math.max(MIN_MASS, value.y),
            Math.max(MIN_MASS, value.z),
        );
        if (!this._automaticInertiaTensor) this.reapplyMassProperties();
    }
    setInertiaTensorRotation (x: number, y: number, z: number, w: number): void {
        this._inertiaTensorRotation.set(x, y, z, w);
        Quat.normalize(this._inertiaTensorRotation, this._inertiaTensorRotation);
        if (!this._automaticInertiaTensor) this.reapplyMassProperties();
    }
    setMaxLinearVelocity (value: number): void { this._maxLinearVelocity = Math.max(0, value); }
    setMaxAngularVelocity (value: number): void { this._maxAngularVelocity = Math.max(0, value); }
    setLinearFactor (value: IVec3Like): void {
        Vec3.copy(this._linearFactor, value);
        this._rebuildAxisLockConstraint();
    }
    setAngularFactor (value: IVec3Like): void {
        Vec3.copy(this._angularFactor, value);
        this._rebuildAxisLockConstraint();
    }
    setAllowSleep (value: boolean): void {
        this._allowSleep = value;
        const control = value ? this._instance.ActivationControl.SIMULATION_CONTROLLED : this._instance.ActivationControl.ALWAYS_ACTIVE;
        this._check(this._instance.HP_Body_SetActivationControl(this.impl, control), 'HP_Body_SetActivationControl');
    }

    wakeUp (): void {
        this._check(this._instance.HP_Body_SetActivationState(this.impl, this._instance.ActivationState.ACTIVE), 'HP_Body_SetActivationState');
    }
    sleep (): void {
        this._check(this._instance.HP_Body_SetActivationState(this.impl, this._instance.ActivationState.INACTIVE), 'HP_Body_SetActivationState');
    }
    clearState (): void { this.clearForces(); this.clearVelocity(); }
    clearForces (): void { this._pendingForce.set(0, 0, 0); this._pendingTorque.set(0, 0, 0); }
    clearVelocity (): void { this.setLinearVelocity(Vec3.ZERO); this.setAngularVelocity(Vec3.ZERO); }
    setSleepThreshold (value: number): void { this._sleepThreshold = value; }
    getSleepThreshold (): number { return this._sleepThreshold; }
    useCCD (value: boolean): void { this._usingCCD = value; }
    isUsingCCD (): boolean { return this._usingCCD; }

    getLinearVelocity (out: IVec3Like): void {
        const [result, velocity] = this._instance.HP_Body_GetLinearVelocity(this.impl);
        this._check(result, 'HP_Body_GetLinearVelocity');
        fromHavokVector3(velocity, out);
    }
    setLinearVelocity (value: IVec3Like): void {
        toHavokVector3(value, this._v0);
        this._v0[0] *= this._linearFactor.x; this._v0[1] *= this._linearFactor.y; this._v0[2] *= this._linearFactor.z;
        this._check(this._instance.HP_Body_SetLinearVelocity(this.impl, this._v0), 'HP_Body_SetLinearVelocity');
        this.wakeUp();
    }
    getAngularVelocity (out: IVec3Like): void {
        const [result, velocity] = this._instance.HP_Body_GetAngularVelocity(this.impl);
        this._check(result, 'HP_Body_GetAngularVelocity');
        fromHavokVector3(velocity, out);
    }
    setAngularVelocity (value: IVec3Like): void {
        toHavokVector3(value, this._v0);
        this._v0[0] *= this._angularFactor.x; this._v0[1] *= this._angularFactor.y; this._v0[2] *= this._angularFactor.z;
        this._check(this._instance.HP_Body_SetAngularVelocity(this.impl, this._v0), 'HP_Body_SetAngularVelocity');
        this.wakeUp();
    }

    applyForce (force: IVec3Like, relativePoint?: IVec3Like): void {
        this._pendingForce.x += force.x * this._linearFactor.x;
        this._pendingForce.y += force.y * this._linearFactor.y;
        this._pendingForce.z += force.z * this._linearFactor.z;
        if (relativePoint) {
            Vec3.cross(this._temp0, relativePoint, force);
            Vec3.add(this._pendingTorque, this._pendingTorque, this._temp0);
        }
        this.wakeUp();
    }
    applyLocalForce (force: IVec3Like, relativePoint?: IVec3Like): void {
        Vec3.transformQuat(this._temp0, force, this._rigidBody.node.worldRotation);
        const point = relativePoint ? Vec3.transformQuat(this._temp1, relativePoint, this._rigidBody.node.worldRotation) : undefined;
        this.applyForce(this._temp0, point);
    }
    applyImpulse (impulse: IVec3Like, relativePoint?: IVec3Like): void {
        const position = this._rigidBody.node.worldPosition;
        this._v0[0] = position.x + (relativePoint?.x ?? 0);
        this._v0[1] = position.y + (relativePoint?.y ?? 0);
        this._v0[2] = position.z + (relativePoint?.z ?? 0);
        toHavokVector3(impulse, this._v1);
        this._v1[0] *= this._linearFactor.x; this._v1[1] *= this._linearFactor.y; this._v1[2] *= this._linearFactor.z;
        this._check(this._instance.HP_Body_ApplyImpulse(this.impl, this._v0, this._v1), 'HP_Body_ApplyImpulse');
        this.wakeUp();
    }
    applyLocalImpulse (impulse: IVec3Like, relativePoint?: IVec3Like): void {
        Vec3.transformQuat(this._temp0, impulse, this._rigidBody.node.worldRotation);
        const point = relativePoint ? Vec3.transformQuat(this._temp1, relativePoint, this._rigidBody.node.worldRotation) : undefined;
        this.applyImpulse(this._temp0, point);
    }
    applyTorque (torque: IVec3Like): void {
        this._pendingTorque.x += torque.x * this._angularFactor.x;
        this._pendingTorque.y += torque.y * this._angularFactor.y;
        this._pendingTorque.z += torque.z * this._angularFactor.z;
        this.wakeUp();
    }
    applyLocalTorque (torque: IVec3Like): void {
        Vec3.transformQuat(this._temp0, torque, this._rigidBody.node.worldRotation);
        this.applyTorque(this._temp0);
    }

    setGroup (value: number): void { this._sharedBody.group = value; }
    getGroup (): number { return this._sharedBody.group; }
    addGroup (value: number): void { this.setGroup(this.getGroup() | value); }
    removeGroup (value: number): void { this.setGroup(this.getGroup() & ~value); }
    setMask (value: number): void { this._sharedBody.mask = value; }
    getMask (): number { return this._sharedBody.mask; }
    addMask (value: number): void { this.setMask(this.getMask() | value); }
    removeMask (value: number): void { this.setMask(this.getMask() & ~value); }

    beforeStep (deltaTime: number): void {
        if (this._pendingForce.lengthSqr() > 0) {
            Vec3.multiplyScalar(this._temp0, this._pendingForce, deltaTime);
            this.applyImpulse(this._temp0);
        }
        if (this._pendingTorque.lengthSqr() > 0) {
            this._v0[0] = this._pendingTorque.x * deltaTime;
            this._v0[1] = this._pendingTorque.y * deltaTime;
            this._v0[2] = this._pendingTorque.z * deltaTime;
            this._check(this._instance.HP_Body_ApplyAngularImpulse(this.impl, this._v0), 'HP_Body_ApplyAngularImpulse');
        }
        this.clearForces();
    }

    afterStep (): void {
        this._clampVelocity(false);
        this._clampVelocity(true);
    }

    reapplyMassProperties (): void {
        if (!this._sharedBody || this._sharedBody.shapes.length === 0 || this._rigidBody.type !== ERigidBodyType.DYNAMIC) return;
        const [result, properties] = this._instance.HP_Shape_BuildMassProperties(this._sharedBody.containerId);
        this._check(result, 'HP_Shape_BuildMassProperties');
        const massProperties: HavokMassProperties = properties;
        massProperties[1] = this._mass;
        if (!this._automaticCenterOfMass) {
            massProperties[0][0] = this._centerOfMass.x;
            massProperties[0][1] = this._centerOfMass.y;
            massProperties[0][2] = this._centerOfMass.z;
        }
        if (!this._automaticInertiaTensor) {
            massProperties[2][0] = this._inertiaTensor.x;
            massProperties[2][1] = this._inertiaTensor.y;
            massProperties[2][2] = this._inertiaTensor.z;
            massProperties[3][0] = this._inertiaTensorRotation.x;
            massProperties[3][1] = this._inertiaTensorRotation.y;
            massProperties[3][2] = this._inertiaTensorRotation.z;
            massProperties[3][3] = this._inertiaTensorRotation.w;
        }
        this._check(this._instance.HP_Body_SetMassProperties(this.impl, massProperties), 'HP_Body_SetMassProperties');
    }

    setGravityFactor (value: number): void { this._check(this._instance.HP_Body_SetGravityFactor(this.impl, value), 'HP_Body_SetGravityFactor'); }
    setActivationPriority (value: number): void {
        this._check(this._instance.HP_Body_SetActivationPriority(this.impl, Math.max(-127, Math.min(127, value))), 'HP_Body_SetActivationPriority');
    }
    setActivationControl (value: number): void {
        const control = Math.max(
            this._instance.ActivationControl.SIMULATION_CONTROLLED,
            Math.min(this._instance.ActivationControl.ALWAYS_INACTIVE, value),
        );
        this._check(this._instance.HP_Body_SetActivationControl(this.impl, control), 'HP_Body_SetActivationControl');
    }
    setMassProperties (properties: HavokMassProperties): void {
        this._check(this._instance.HP_Body_SetMassProperties(this.impl, properties), 'HP_Body_SetMassProperties');
    }
    getMassProperties (): HavokMassProperties {
        const [result, properties] = this._instance.HP_Body_GetMassProperties(this.impl);
        this._check(result, 'HP_Body_GetMassProperties');
        return properties;
    }

    private _clampVelocity (angular: boolean): void {
        const maximum = angular ? this._maxAngularVelocity : this._maxLinearVelocity;
        if (maximum <= 0 || this._rigidBody.type !== ERigidBodyType.DYNAMIC) return;
        const resultAndVelocity = angular
            ? this._instance.HP_Body_GetAngularVelocity(this.impl)
            : this._instance.HP_Body_GetLinearVelocity(this.impl);
        const result = resultAndVelocity[0];
        const velocity = resultAndVelocity[1];
        this._check(result, angular ? 'HP_Body_GetAngularVelocity' : 'HP_Body_GetLinearVelocity');
        const lengthSq = velocity[0] * velocity[0] + velocity[1] * velocity[1] + velocity[2] * velocity[2];
        const maxSq = maximum * maximum;
        if (lengthSq <= maxSq || lengthSq <= 0) return;
        const scale = maximum / Math.sqrt(lengthSq);
        velocity[0] *= scale; velocity[1] *= scale; velocity[2] *= scale;
        const setResult = angular
            ? this._instance.HP_Body_SetAngularVelocity(this.impl, velocity)
            : this._instance.HP_Body_SetLinearVelocity(this.impl, velocity);
        this._check(setResult, angular ? 'HP_Body_SetAngularVelocity' : 'HP_Body_SetLinearVelocity');
    }

    private _rebuildAxisLockConstraint (): void {
        this._destroyAxisLockConstraint();
        if (!this._sharedBody || this._rigidBody.type !== ERigidBodyType.DYNAMIC) return;
        const lockLinear = [this._linearFactor.x === 0, this._linearFactor.y === 0, this._linearFactor.z === 0];
        const lockAngular = [this._angularFactor.x === 0, this._angularFactor.y === 0, this._angularFactor.z === 0];
        if (!lockLinear[0] && !lockLinear[1] && !lockLinear[2] && !lockAngular[0] && !lockAngular[1] && !lockAngular[2]) return;

        const [result, constraint] = this._instance.HP_Constraint_Create();
        this._check(result, 'HP_Constraint_Create(axis lock)');
        this._axisLockConstraint = constraint;
        this._check(this._instance.HP_Constraint_SetParentBody(constraint, this.impl), 'HP_Constraint_SetParentBody(axis lock)');
        this._check(this._instance.HP_Constraint_SetChildBody(constraint, HAVOK_FIXED_BODY), 'HP_Constraint_SetChildBody(axis lock)');

        const position = this._rigidBody.node.worldPosition;
        this._lockPivotWorld[0] = position.x; this._lockPivotWorld[1] = position.y; this._lockPivotWorld[2] = position.z;
        Vec3.transformQuat(this._temp0, Vec3.UNIT_X, this._rigidBody.node.worldRotation);
        Vec3.transformQuat(this._temp1, Vec3.UNIT_Y, this._rigidBody.node.worldRotation);
        this._lockAxisXWorld[0] = this._temp0.x; this._lockAxisXWorld[1] = this._temp0.y; this._lockAxisXWorld[2] = this._temp0.z;
        this._lockAxisYWorld[0] = this._temp1.x; this._lockAxisYWorld[1] = this._temp1.y; this._lockAxisYWorld[2] = this._temp1.z;
        this._check(
            this._instance.HP_Constraint_SetAnchorInParent(
                constraint,
                this._lockPivotParent,
                this._lockAxisXParent,
                this._lockAxisYParent,
            ),
            'HP_Constraint_SetAnchorInParent(axis lock)',
        );
        this._check(
            this._instance.HP_Constraint_SetAnchorInChild(
                constraint,
                this._lockPivotWorld,
                this._lockAxisXWorld,
                this._lockAxisYWorld,
            ),
            'HP_Constraint_SetAnchorInChild(axis lock)',
        );

        const free = this._instance.ConstraintAxisLimitMode.FREE;
        const locked = this._instance.ConstraintAxisLimitMode.LOCKED;
        for (let axis = 0; axis < 6; axis++) {
            const shouldLock = axis < 3 ? lockLinear[axis] : lockAngular[axis - 3];
            this._check(
                this._instance.HP_Constraint_SetAxisMode(constraint, axis, shouldLock ? locked : free),
                'HP_Constraint_SetAxisMode(axis lock)',
            );
        }
        this._check(this._instance.HP_Constraint_SetCollisionsEnabled(constraint, 1), 'HP_Constraint_SetCollisionsEnabled(axis lock)');
        this._check(this._instance.HP_Constraint_SetEnabled(constraint, 1), 'HP_Constraint_SetEnabled(axis lock)');
    }

    private _destroyAxisLockConstraint (): void {
        if (!this._axisLockConstraint || !this._instance) return;
        this._instance.HP_Constraint_SetEnabled(this._axisLockConstraint, 0);
        this._check(this._instance.HP_Constraint_Release(this._axisLockConstraint), 'HP_Constraint_Release(axis lock)');
        this._axisLockConstraint = null;
    }

    private _check (result: HavokResult, operation: string): void { assertHavokResult(this._instance, result, operation); }
}
