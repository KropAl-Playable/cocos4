/*
 Copyright (c) 2026 KropAl-Playable
 SPDX-License-Identifier: MIT
 */

import { IVec3Like, Vec3 } from '../../core';
import { ERigidBodyType, PhysicsSystem, RigidBody } from '../framework';
import type { IRigidBody } from '../spec/i-rigid-body';
import { HavokSharedBody } from './havok-shared-body';
import type { HavokBodyId, HavokMassProperties, HavokModule, HavokResult, HavokVector3 } from './havok-types';
import { assertHavokResult, fromHavokVector3, toHavokVector3 } from './havok-util';
import type { HavokWorld } from './havok-world';

const MIN_MASS = 0.000001;

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
    private readonly _linearFactor = new Vec3(1, 1, 1);
    private readonly _angularFactor = new Vec3(1, 1, 1);
    private readonly _pendingForce = new Vec3();
    private readonly _pendingTorque = new Vec3();
    private readonly _v0: HavokVector3 = [0, 0, 0];
    private readonly _v1: HavokVector3 = [0, 0, 0];
    private readonly _temp0 = new Vec3();
    private readonly _temp1 = new Vec3();

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
        this._sharedBody.reference = false;
        (this._rigidBody as any) = null;
        (this._sharedBody as any) = null;
    }

    setType (value: ERigidBodyType): void { this._sharedBody.setType(value); }
    setMass (value: number): void { this._mass = Math.max(MIN_MASS, value); this.reapplyMassProperties(); }
    setLinearDamping (value: number): void { this._check(this._instance.HP_Body_SetLinearDamping(this.impl, value), 'HP_Body_SetLinearDamping'); }
    setAngularDamping (value: number): void { this._check(this._instance.HP_Body_SetAngularDamping(this.impl, value), 'HP_Body_SetAngularDamping'); }
    useGravity (value: boolean): void { this._check(this._instance.HP_Body_SetGravityFactor(this.impl, value ? 1 : 0), 'HP_Body_SetGravityFactor'); }
    setLinearFactor (value: IVec3Like): void { Vec3.copy(this._linearFactor, value); }
    setAngularFactor (value: IVec3Like): void { Vec3.copy(this._angularFactor, value); }
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

    reapplyMassProperties (): void {
        if (!this._sharedBody || this._sharedBody.shapes.length === 0 || this._rigidBody.type !== ERigidBodyType.DYNAMIC) return;
        const [result, properties] = this._instance.HP_Shape_BuildMassProperties(this._sharedBody.containerId);
        this._check(result, 'HP_Shape_BuildMassProperties');
        const massProperties: HavokMassProperties = properties;
        massProperties[1] = this._mass;
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

    private _check (result: HavokResult, operation: string): void { assertHavokResult(this._instance, result, operation); }
}
