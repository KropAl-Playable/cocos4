/*
 Copyright (c) 2026 KropAl-Playable
 SPDX-License-Identifier: MIT
 */

import { IVec3Like, Quat, toRadian, Vec3 } from '../../../core';
import {
    ConfigurableConstraint,
    Constraint,
    EConstraintMode,
    EDriverMode,
    HingeConstraint,
    PointToPointConstraint,
    RigidBody,
} from '../../framework';
import type {
    IBaseConstraint,
    IConfigurableConstraint,
    IFixedConstraint,
    IHingeConstraint,
    IPointToPointConstraint,
} from '../../spec/i-physics-constraint';
import { HavokRigidBody } from '../havok-rigid-body';
import type { HavokBodyId, HavokConstraintId, HavokModule, HavokResult, HavokVector3 } from '../havok-types';
import { assertHavokResult } from '../havok-util';

const HAVOK_ZERO_ID = (globalThis as unknown as { BigInt: (value: number) => bigint }).BigInt(0);
const FIXED_BODY: HavokBodyId = [HAVOK_ZERO_ID];

function copy3 (out: HavokVector3, v: IVec3Like): void {
    out[0] = v.x; out[1] = v.y; out[2] = v.z;
}

export abstract class HavokConstraint implements IBaseConstraint {
    get impl (): HavokConstraintId | null { return this._impl; }
    protected get instance (): HavokModule { return this._bodyA.sharedBody.world.instance; }

    protected _component!: Constraint;
    protected _bodyA!: HavokRigidBody;
    protected _connectedBody: RigidBody | null = null;
    protected _impl: HavokConstraintId | null = null;
    protected _enabled = false;

    private readonly _pivotA: HavokVector3 = [0, 0, 0];
    private readonly _pivotB: HavokVector3 = [0, 0, 0];
    private readonly _axisXA: HavokVector3 = [1, 0, 0];
    private readonly _axisYA: HavokVector3 = [0, 1, 0];
    private readonly _axisXB: HavokVector3 = [1, 0, 0];
    private readonly _axisYB: HavokVector3 = [0, 1, 0];
    private readonly _tmp0 = new Vec3();
    private readonly _tmp1 = new Vec3();
    private readonly _inv = new Quat();

    initialize (component: Constraint): void {
        this._component = component;
        this._bodyA = component.attachedBody!.body as HavokRigidBody;
        this._connectedBody = component.connectedBody;
    }

    onEnable (): void { this._enabled = true; this._create(); }
    onDisable (): void { this._enabled = false; this._destroy(); }
    onDestroy (): void { this._destroy(); this._connectedBody = null; }
    setConnectedBody (body: RigidBody | null): void { this._connectedBody = body; if (this._enabled) this._create(); }

    setEnableCollision (value: boolean): void {
        if (!this._impl) return;
        this._check(this.instance.HP_Constraint_SetCollisionsEnabled(this._impl, value ? 1 : 0), 'HP_Constraint_SetCollisionsEnabled');
    }

    protected abstract _configure (): void;

    protected _create (): void {
        this._destroy();
        const [result, handle] = this.instance.HP_Constraint_Create();
        this._check(result, 'HP_Constraint_Create');
        this._impl = handle;
        this._check(this.instance.HP_Constraint_SetParentBody(handle, this._bodyA.impl), 'HP_Constraint_SetParentBody');
        this._check(this.instance.HP_Constraint_SetChildBody(handle, this._bodyB()), 'HP_Constraint_SetChildBody');
        this._configure();
        this.setEnableCollision(this._component.enableCollision);
        this._check(this.instance.HP_Constraint_SetEnabled(handle, 1), 'HP_Constraint_SetEnabled');
    }

    protected _destroy (): void {
        if (!this._impl) return;
        this.instance.HP_Constraint_SetEnabled(this._impl, 0);
        this._check(this.instance.HP_Constraint_Release(this._impl), 'HP_Constraint_Release');
        this._impl = null;
    }

    protected _bodyB (): HavokBodyId {
        return (this._connectedBody?.body as HavokRigidBody | null)?.impl ?? FIXED_BODY;
    }

    protected _setMode (axis: number, mode: EConstraintMode): void {
        if (!this._impl) return;
        const hkMode = mode === EConstraintMode.LOCKED
            ? this.instance.ConstraintAxisLimitMode.LOCKED
            : mode === EConstraintMode.LIMITED
                ? this.instance.ConstraintAxisLimitMode.LIMITED
                : this.instance.ConstraintAxisLimitMode.FREE;
        this._check(this.instance.HP_Constraint_SetAxisMode(this._impl, axis, hkMode), 'HP_Constraint_SetAxisMode');
    }

    protected _setLimit (axis: number, lower: number, upper: number): void {
        if (!this._impl) return;
        this._check(this.instance.HP_Constraint_SetAxisMinLimit(this._impl, axis, lower), 'HP_Constraint_SetAxisMinLimit');
        this._check(this.instance.HP_Constraint_SetAxisMaxLimit(this._impl, axis, upper), 'HP_Constraint_SetAxisMaxLimit');
    }

    protected _setAnchor (
        pivotA: IVec3Like,
        pivotB: IVec3Like,
        axis: IVec3Like,
        secondary: IVec3Like,
        autoPivotB = false,
    ): void {
        if (!this._impl) return;
        const nodeA = this._bodyA.rigidBody.node;
        const scaleA = nodeA.worldScale;
        this._pivotA[0] = pivotA.x * scaleA.x;
        this._pivotA[1] = pivotA.y * scaleA.y;
        this._pivotA[2] = pivotA.z * scaleA.z;

        Vec3.normalize(this._tmp0, axis);
        Vec3.normalize(this._tmp1, secondary);
        copy3(this._axisXA, this._tmp0);
        copy3(this._axisYA, this._tmp1);

        if (this._connectedBody) {
            const nodeB = this._connectedBody.node;
            if (autoPivotB) {
                Vec3.transformRTS(this._tmp0, pivotA, nodeA.worldRotation, nodeA.worldPosition, nodeA.worldScale);
                Vec3.transformInverseRTS(this._tmp0, this._tmp0, nodeB.worldRotation, nodeB.worldPosition, nodeB.worldScale);
                copy3(this._pivotB, this._tmp0);
            } else {
                const scaleB = nodeB.worldScale;
                this._pivotB[0] = pivotB.x * scaleB.x;
                this._pivotB[1] = pivotB.y * scaleB.y;
                this._pivotB[2] = pivotB.z * scaleB.z;
            }
            Quat.invert(this._inv, nodeB.worldRotation);
            Vec3.transformQuat(this._tmp0, axis, nodeA.worldRotation);
            Vec3.transformQuat(this._tmp0, this._tmp0, this._inv);
            Vec3.transformQuat(this._tmp1, secondary, nodeA.worldRotation);
            Vec3.transformQuat(this._tmp1, this._tmp1, this._inv);
            Vec3.normalize(this._tmp0, this._tmp0);
            Vec3.normalize(this._tmp1, this._tmp1);
            copy3(this._axisXB, this._tmp0);
            copy3(this._axisYB, this._tmp1);
        } else {
            if (autoPivotB) {
                Vec3.transformRTS(this._tmp0, pivotA, nodeA.worldRotation, nodeA.worldPosition, nodeA.worldScale);
                copy3(this._pivotB, this._tmp0);
            } else {
                copy3(this._pivotB, pivotB);
            }
            Vec3.transformQuat(this._tmp0, axis, nodeA.worldRotation);
            Vec3.transformQuat(this._tmp1, secondary, nodeA.worldRotation);
            Vec3.normalize(this._tmp0, this._tmp0);
            Vec3.normalize(this._tmp1, this._tmp1);
            copy3(this._axisXB, this._tmp0);
            copy3(this._axisYB, this._tmp1);
        }

        this._check(this.instance.HP_Constraint_SetAnchorInParent(this._impl, this._pivotA, this._axisXA, this._axisYA), 'HP_Constraint_SetAnchorInParent');
        this._check(this.instance.HP_Constraint_SetAnchorInChild(this._impl, this._pivotB, this._axisXB, this._axisYB), 'HP_Constraint_SetAnchorInChild');
    }

    protected _check (result: HavokResult, operation: string): void {
        assertHavokResult(this.instance, result, operation);
    }
}

export class HavokPointToPointConstraint extends HavokConstraint implements IPointToPointConstraint {
    private readonly _a = new Vec3();
    private readonly _b = new Vec3();

    initialize (component: Constraint): void {
        super.initialize(component);
        const c = component as PointToPointConstraint;
        Vec3.copy(this._a, c.pivotA);
        Vec3.copy(this._b, c.pivotB);
    }

    setPivotA (v: IVec3Like): void { Vec3.copy(this._a, v); if (this._enabled) this._configure(); }
    setPivotB (v: IVec3Like): void { Vec3.copy(this._b, v); if (this._enabled) this._configure(); }

    protected _configure (): void {
        this._setAnchor(this._a, this._b, Vec3.UNIT_X, Vec3.UNIT_Y);
        for (let axis = 0; axis < 3; axis++) this._setMode(axis, EConstraintMode.LOCKED);
        for (let axis = 3; axis < 6; axis++) this._setMode(axis, EConstraintMode.FREE);
    }
}

export class HavokHingeConstraint extends HavokConstraint implements IHingeConstraint {
    private readonly _a = new Vec3();
    private readonly _b = new Vec3();
    private readonly _axis = new Vec3(0, 1, 0);
    private readonly _secondary = new Vec3(1, 0, 0);
    private _limitEnabled = false;
    private _lower = 0;
    private _upper = 0;
    private _motorEnabled = false;
    private _motorVelocity = 0;
    private _motorForce = 0;

    initialize (component: Constraint): void {
        super.initialize(component);
        const c = component as HingeConstraint;
        Vec3.copy(this._a, c.pivotA);
        Vec3.copy(this._b, c.pivotB);
        Vec3.copy(this._axis, c.axis);
        this._limitEnabled = c.limitEnabled;
        this._lower = c.lowerLimit;
        this._upper = c.upperLimit;
        this._motorEnabled = c.motorEnabled;
        this._motorVelocity = c.motorVelocity;
        this._motorForce = c.motorForceLimit;
    }

    setPivotA (v: IVec3Like): void { Vec3.copy(this._a, v); if (this._enabled) this._configure(); }
    setPivotB (v: IVec3Like): void { Vec3.copy(this._b, v); if (this._enabled) this._configure(); }
    setAxis (v: IVec3Like): void { Vec3.copy(this._axis, v); if (this._enabled) this._configure(); }
    setLimitEnabled (v: boolean): void { this._limitEnabled = v; this._syncLimit(); }
    setLowerLimit (v: number): void { this._lower = v; this._syncLimit(); }
    setUpperLimit (v: number): void { this._upper = v; this._syncLimit(); }
    setMotorEnabled (v: boolean): void { this._motorEnabled = v; this._syncMotor(); }
    setMotorVelocity (v: number): void { this._motorVelocity = v; this._syncMotor(); }
    setMotorForceLimit (v: number): void { this._motorForce = v; this._syncMotor(); }

    protected _configure (): void {
        const helper = Math.abs(this._axis.x) < 0.9 ? Vec3.UNIT_X : Vec3.UNIT_Y;
        Vec3.cross(this._secondary, this._axis, helper);
        Vec3.normalize(this._secondary, this._secondary);
        this._setAnchor(this._a, this._b, this._axis, this._secondary);

        for (let axis = 0; axis < 3; axis++) this._setMode(axis, EConstraintMode.LOCKED);
        this._setMode(3, EConstraintMode.FREE);
        this._setMode(4, EConstraintMode.LOCKED);
        this._setMode(5, EConstraintMode.LOCKED);
        this._syncLimit();
        this._syncMotor();
    }

    private _syncLimit (): void {
        if (!this._impl) return;
        const axis = this.instance.ConstraintAxis.ANGULAR_X;
        this._setMode(axis, this._limitEnabled ? EConstraintMode.LIMITED : EConstraintMode.FREE);
        if (this._limitEnabled) this._setLimit(axis, toRadian(this._lower), toRadian(this._upper));
    }

    private _syncMotor (): void {
        if (!this._impl) return;
        const axis = this.instance.ConstraintAxis.ANGULAR_X;
        const type = this._motorEnabled ? this.instance.ConstraintMotorType.VELOCITY : this.instance.ConstraintMotorType.NONE;
        this._check(this.instance.HP_Constraint_SetAxisMotorType(this._impl, axis, type), 'HP_Constraint_SetAxisMotorType');
        if (!this._motorEnabled) return;
        this._check(this.instance.HP_Constraint_SetAxisMotorVelocityTarget(this._impl, axis, toRadian(this._motorVelocity)), 'HP_Constraint_SetAxisMotorVelocityTarget');
        this._check(this.instance.HP_Constraint_SetAxisMotorMaxForce(this._impl, axis, this._motorForce), 'HP_Constraint_SetAxisMotorMaxForce');
    }
}

export class HavokFixedConstraint extends HavokConstraint implements IFixedConstraint {
    setBreakForce (_v: number): void {}
    setBreakTorque (_v: number): void {}

    protected _configure (): void {
        this._setAnchor(Vec3.ZERO, Vec3.ZERO, Vec3.UNIT_X, Vec3.UNIT_Y, true);
        for (let axis = 0; axis < 6; axis++) this._setMode(axis, EConstraintMode.LOCKED);
    }
}

export class HavokConfigurableConstraint extends HavokConstraint implements IConfigurableConstraint {
    private readonly _driverModes = [
        EDriverMode.DISABLED, EDriverMode.DISABLED, EDriverMode.DISABLED,
        EDriverMode.DISABLED, EDriverMode.DISABLED, EDriverMode.DISABLED,
    ];

    private get constraint (): ConfigurableConstraint { return this._component as ConfigurableConstraint; }

    protected _configure (): void {
        const c = this.constraint;
        const linear = c.linearLimitSettings;
        const angular = c.angularLimitSettings;

        this._setAnchor(c.pivotA, c.pivotB, c.axis, c.secondaryAxis, c.autoPivotB);
        this.setConstraintMode(0, linear.xMotion);
        this.setConstraintMode(1, linear.yMotion);
        this.setConstraintMode(2, linear.zMotion);
        this.setConstraintMode(3, angular.twistMotion);
        this.setConstraintMode(4, angular.swingMotion1);
        this.setConstraintMode(5, angular.swingMotion2);

        this.setLinearLimit(0, linear.lower.x, linear.upper.x);
        this.setLinearLimit(1, linear.lower.y, linear.upper.y);
        this.setLinearLimit(2, linear.lower.z, linear.upper.z);
        this.setAngularExtent(angular.twistExtent, angular.swingExtent1, angular.swingExtent2);

        this.setLinearStiffness(linear.enableSoftConstraint ? linear.stiffness : 0);
        this.setLinearDamping(linear.enableSoftConstraint ? linear.damping : 0);
        this.setSwingStiffness(angular.enableSoftConstraintSwing ? angular.swingStiffness : 0);
        this.setSwingDamping(angular.enableSoftConstraintSwing ? angular.swingDamping : 0);
        this.setTwistStiffness(angular.enableSoftConstraintTwist ? angular.twistStiffness : 0);
        this.setTwistDamping(angular.enableSoftConstraintTwist ? angular.twistDamping : 0);

        const ld = c.linearDriverSettings;
        const ad = c.angularDriverSettings;
        this.setDriverMode(0, ld.xDrive);
        this.setDriverMode(1, ld.yDrive);
        this.setDriverMode(2, ld.zDrive);
        this.setDriverMode(3, ad.twistDrive);
        this.setDriverMode(4, ad.swingDrive1);
        this.setDriverMode(5, ad.swingDrive2);
        this.setLinearMotorTarget(ld.targetPosition);
        this.setLinearMotorVelocity(ld.targetVelocity);
        this.setLinearMotorForceLimit(ld.strength);
        this.setAngularMotorTarget(ad.targetOrientation);
        this.setAngularMotorVelocity(ad.targetVelocity);
        this.setAngularMotorForceLimit(ad.strength);
    }

    setConstraintMode (idx: number, value: EConstraintMode): void { this._setMode(idx, value); }
    setLinearLimit (idx: number, lower: number, upper: number): void { this._setLimit(idx, lower, upper); }

    setAngularExtent (twist: number, swing1: number, swing2: number): void {
        this._setLimit(3, -toRadian(twist) * 0.5, toRadian(twist) * 0.5);
        this._setLimit(4, -toRadian(swing1) * 0.5, toRadian(swing1) * 0.5);
        this._setLimit(5, -toRadian(swing2) * 0.5, toRadian(swing2) * 0.5);
    }

    setLinearRestitution (_v: number): void {}
    setSwingRestitution (_v: number): void {}
    setTwistRestitution (_v: number): void {}
    setLinearSoftConstraint (_v: boolean): void { if (this._enabled) this._configure(); }
    setSwingSoftConstraint (_v: boolean): void { if (this._enabled) this._configure(); }
    setTwistSoftConstraint (_v: boolean): void { if (this._enabled) this._configure(); }

    setLinearStiffness (v: number): void { this._setAxisProperty([0, 1, 2], true, v); }
    setLinearDamping (v: number): void { this._setAxisProperty([0, 1, 2], false, v); }
    setSwingStiffness (v: number): void { this._setAxisProperty([4, 5], true, v); }
    setSwingDamping (v: number): void { this._setAxisProperty([4, 5], false, v); }
    setTwistStiffness (v: number): void { this._setAxisProperty([3], true, v); }
    setTwistDamping (v: number): void { this._setAxisProperty([3], false, v); }

    setDriverMode (idx: number, mode: EDriverMode): void {
        this._driverModes[idx] = mode;
        if (!this._impl) return;
        const type = mode === EDriverMode.SERVO
            ? this.instance.ConstraintMotorType.POSITION
            : mode === EDriverMode.INDUCTION
                ? this.instance.ConstraintMotorType.VELOCITY
                : this.instance.ConstraintMotorType.NONE;
        this._check(this.instance.HP_Constraint_SetAxisMotorType(this._impl, idx, type), 'HP_Constraint_SetAxisMotorType');
    }

    setLinearMotorTarget (v: IVec3Like): void { this._setMotorVector(v, false, false); }
    setLinearMotorVelocity (v: IVec3Like): void { this._setMotorVector(v, false, true); }
    setLinearMotorForceLimit (v: number): void { this._setMotorForce([0, 1, 2], v); }
    setAngularMotorTarget (v: IVec3Like): void { this._setMotorVector(v, true, false); }
    setAngularMotorVelocity (v: IVec3Like): void { this._setMotorVector(v, true, true); }
    setAngularMotorForceLimit (v: number): void { this._setMotorForce([3, 4, 5], v); }

    setPivotA (_v: IVec3Like): void { if (this._enabled) this._configure(); }
    setPivotB (_v: IVec3Like): void { if (this._enabled) this._configure(); }
    setAutoPivotB (_v: boolean): void { if (this._enabled) this._configure(); }
    setAxis (_v: IVec3Like): void { if (this._enabled) this._configure(); }
    setSecondaryAxis (_v: IVec3Like): void { if (this._enabled) this._configure(); }
    setBreakForce (_v: number): void {}
    setBreakTorque (_v: number): void {}

    private _setAxisProperty (axes: number[], stiffness: boolean, value: number): void {
        if (!this._impl) return;
        for (const axis of axes) {
            const result = stiffness
                ? this.instance.HP_Constraint_SetAxisStiffness(this._impl, axis, value)
                : this.instance.HP_Constraint_SetAxisDamping(this._impl, axis, value);
            this._check(result, stiffness ? 'HP_Constraint_SetAxisStiffness' : 'HP_Constraint_SetAxisDamping');
        }
    }

    private _setMotorVector (v: IVec3Like, angular: boolean, velocity: boolean): void {
        if (!this._impl) return;
        const values = [v.x, v.y, v.z];
        for (let i = 0; i < 3; i++) {
            const axis = i + (angular ? 3 : 0);
            const expected = velocity ? EDriverMode.INDUCTION : EDriverMode.SERVO;
            if (this._driverModes[axis] !== expected) continue;
            const value = angular ? -toRadian(values[i]) : values[i];
            const result = velocity
                ? this.instance.HP_Constraint_SetAxisMotorVelocityTarget(this._impl, axis, value)
                : this.instance.HP_Constraint_SetAxisMotorPositionTarget(this._impl, axis, value);
            this._check(result, velocity ? 'HP_Constraint_SetAxisMotorVelocityTarget' : 'HP_Constraint_SetAxisMotorPositionTarget');
        }
    }

    private _setMotorForce (axes: number[], value: number): void {
        if (!this._impl) return;
        for (const axis of axes) {
            if (this._driverModes[axis] === EDriverMode.DISABLED) continue;
            this._check(this.instance.HP_Constraint_SetAxisMotorMaxForce(this._impl, axis, value), 'HP_Constraint_SetAxisMotorMaxForce');
        }
    }
}
