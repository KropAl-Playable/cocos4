/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable func-names */
/*
 Copyright (c) 2020-2023 Xiamen Yaji Software Co., Ltd.

 https://www.cocos.com/

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights to
 use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 of the Software, and to permit persons to whom the Software is furnished to do so,
 subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
*/

import {
    ccclass,
    help,
    disallowMultiple,
    executeInEditMode,
    menu,
    executionOrder,
    tooltip,
    displayOrder,
    visible,
    type,
    serializable,
} from 'cc.decorator';
import { DEBUG } from 'internal:constants';
import { Vec3, error, warn } from '../../../core';
import { Component } from '../../../scene-graph';
import { IRigidBody } from '../../spec/i-rigid-body';
import { selector, createRigidBody, getPhysicsBackendCapabilities } from '../physics-selector';
import { ERigidBodyType } from '../physics-enum';
import { PhysicsSystem } from '../physics-system';

/**
 * @en
 * Rigid body component.
 * @zh
 * 刚体组件。
 */
@ccclass('cc.RigidBody')
@help('i18n:cc.RigidBody')
@menu('Physics/RigidBody')
@executeInEditMode
@disallowMultiple
@executionOrder(-1)
export class RigidBody extends Component {
    /**
     * @en
     * Enumeration of rigid body types.
     * @zh
     * 刚体类型的枚举。
     */
    static readonly Type = ERigidBodyType;

    /// PUBLIC PROPERTY GETTER\SETTER ///

    /**
     * @en
     * Gets or sets the group of the rigid body.
     * @zh
     * 获取或设置分组。
     */
    @type(PhysicsSystem.PhysicsGroup)
    @displayOrder(-2)
    @tooltip('i18n:physics3d.rigidbody.group')
    public get group (): number {
        return this._group;
    }

    public set group (v: number) {
        if (DEBUG && !Number.isInteger(Math.log2(v >>> 0))) warn('[Physics]: The group should only have one bit.');
        this._group = v;
        if (this._body) {
            // The judgment is added here because the data exists in two places
            if (this._body.getGroup() !== v) this._body.setGroup(v);
        }
    }

    /**
     * @en
     * Gets or sets the type of rigid body.
     * @zh
     * 获取或设置刚体类型。
     */
    @type(ERigidBodyType)
    @displayOrder(-1)
    @tooltip('i18n:physics3d.rigidbody.type')
    public get type (): ERigidBodyType {
        return this._type;
    }

    public set type (v: ERigidBodyType) {
        if (this._type === v) return;
        this._type = v;
        if (this._body) this._body.setType(v);
    }

    /**
     * @en
     * Gets or sets the mass of the rigid body.
     * @zh
     * 获取或设置刚体的质量。
     */
    @visible(isDynamicBody)
    @displayOrder(0)
    @tooltip('i18n:physics3d.rigidbody.mass')
    public get mass (): number {
        return this._mass;
    }

    public set mass (value) {
        if (DEBUG && value <= 0) warn('[Physics]: The mass should be greater than zero.');
        if (this._mass === value) return;
        value = value <= 0 ? 0.0001 : value;
        this._mass = value;
        if (this._body) this._body.setMass(value);
    }

    /**
     * @en
     * Gets or sets whether hibernation is allowed.
     * @zh
     * 获取或设置是否允许休眠。
     */
    @visible(isDynamicBody)
    @displayOrder(0.5)
    @tooltip('i18n:physics3d.rigidbody.allowSleep')
    public get allowSleep (): boolean {
        return this._allowSleep;
    }

    public set allowSleep (v: boolean) {
        this._allowSleep = v;
        if (this._body) this._body.setAllowSleep(v);
    }

    /**
     * @en
     * Gets or sets linear damping.
     * @zh
     * 获取或设置线性阻尼。
     */
    @visible(isDynamicBody)
    @displayOrder(1)
    @tooltip('i18n:physics3d.rigidbody.linearDamping')
    public get linearDamping (): number {
        return this._linearDamping;
    }

    public set linearDamping (value) {
        if (DEBUG && (value < 0 || value > 1)) warn('[Physics]: The damping should be between zero to one.');
        this._linearDamping = value;
        if (this._body) this._body.setLinearDamping(value);
    }

    /**
     * @en
     * Gets or sets the rotation damping.
     * @zh
     * 获取或设置旋转阻尼。
     */
    @visible(isDynamicBody)
    @displayOrder(2)
    @tooltip('i18n:physics3d.rigidbody.angularDamping')
    public get angularDamping (): number {
        return this._angularDamping;
    }

    public set angularDamping (value) {
        if (DEBUG && (value < 0 || value > 1)) warn('[Physics]: The damping should be between zero to one.');
        this._angularDamping = value;
        if (this._body) this._body.setAngularDamping(value);
    }

    /**
     * @en
     * Gets or sets whether a rigid body uses gravity.
     * @zh
     * 获取或设置刚体是否使用重力。
     */
    @visible(isDynamicBody)
    @displayOrder(4)
    @tooltip('i18n:physics3d.rigidbody.useGravity')
    public get useGravity (): boolean {
        return this._useGravity;
    }

    public set useGravity (value) {
        this._useGravity = value;
        if (this._body) this._body.useGravity(value);
    }

    /**
     * @en Per-body gravity multiplier. Zero disables gravity for this body.
     * Backends without native gravity scaling fall back to the legacy on/off behavior.
     * @zh 刚体重力倍率。0 表示禁用重力；不支持倍率的后端会退化为开关行为。
     */
    @visible(isDynamicBody)
    @displayOrder(4.5)
    @tooltip('i18n:physics3d.rigidbody.gravityScale')
    public get gravityScale (): number {
        return this._gravityScale;
    }

    public set gravityScale (value: number) {
        this._gravityScale = value;
        this._applyGravitySettings();
    }

    /**
     * @en Whether collider geometry should determine the center of mass automatically.
     * @zh 是否由碰撞体几何自动计算质心。
     */
    @visible(isDynamicBody)
    @displayOrder(5)
    @tooltip('i18n:physics3d.rigidbody.automaticCenterOfMass')
    public get automaticCenterOfMass (): boolean {
        return this._automaticCenterOfMass;
    }

    public set automaticCenterOfMass (value: boolean) {
        this._automaticCenterOfMass = value;
        if (this._body?.setAutomaticCenterOfMass) this._body.setAutomaticCenterOfMass(value);
        if (!value && this._body?.setCenterOfMass) this._body.setCenterOfMass(this._centerOfMass);
    }

    /**
     * @en Local-space center of mass used when automaticCenterOfMass is disabled.
     * @zh 关闭自动质心后使用的本地空间质心。
     */
    @type(Vec3)
    @visible(isDynamicBody)
    @displayOrder(5.5)
    @tooltip('i18n:physics3d.rigidbody.centerOfMass')
    public get centerOfMass (): Vec3 {
        return this._centerOfMass;
    }

    public set centerOfMass (value: Vec3) {
        Vec3.copy(this._centerOfMass, value);
        if (!this._automaticCenterOfMass && this._body?.setCenterOfMass) {
            this._body.setCenterOfMass(this._centerOfMass);
        }
    }


    @visible(isDynamicBody)
    @displayOrder(5.8)
    @tooltip('i18n:physics3d.rigidbody.freezePositionX')
    public get freezePositionX (): boolean { return this._freezePositionX; }
    public set freezePositionX (value: boolean) { this._freezePositionX = value; this._applyLinearConstraints(); }

    @visible(isDynamicBody)
    @displayOrder(5.81)
    @tooltip('i18n:physics3d.rigidbody.freezePositionY')
    public get freezePositionY (): boolean { return this._freezePositionY; }
    public set freezePositionY (value: boolean) { this._freezePositionY = value; this._applyLinearConstraints(); }

    @visible(isDynamicBody)
    @displayOrder(5.82)
    @tooltip('i18n:physics3d.rigidbody.freezePositionZ')
    public get freezePositionZ (): boolean { return this._freezePositionZ; }
    public set freezePositionZ (value: boolean) { this._freezePositionZ = value; this._applyLinearConstraints(); }

    @visible(isDynamicBody)
    @displayOrder(5.9)
    @tooltip('i18n:physics3d.rigidbody.freezeRotationX')
    public get freezeRotationX (): boolean { return this._freezeRotationX; }
    public set freezeRotationX (value: boolean) { this._freezeRotationX = value; this._applyAngularConstraints(); }

    @visible(isDynamicBody)
    @displayOrder(5.91)
    @tooltip('i18n:physics3d.rigidbody.freezeRotationY')
    public get freezeRotationY (): boolean { return this._freezeRotationY; }
    public set freezeRotationY (value: boolean) { this._freezeRotationY = value; this._applyAngularConstraints(); }

    @visible(isDynamicBody)
    @displayOrder(5.92)
    @tooltip('i18n:physics3d.rigidbody.freezeRotationZ')
    public get freezeRotationZ (): boolean { return this._freezeRotationZ; }
    public set freezeRotationZ (value: boolean) { this._freezeRotationZ = value; this._applyAngularConstraints(); }

    /**
     * @en Convenience switch that freezes or unfreezes all rotational axes.
     * @zh 冻结或解冻全部旋转轴的便捷开关。
     */
    public get freezeRotation (): boolean {
        return this._freezeRotationX && this._freezeRotationY && this._freezeRotationZ;
    }

    public set freezeRotation (value: boolean) {
        this._freezeRotationX = value;
        this._freezeRotationY = value;
        this._freezeRotationZ = value;
        this._applyAngularConstraints();
    }

    /**
     * @en
     * Gets or sets the linear velocity factor that can be used to control the scaling of the velocity in each axis direction.
     * @zh
     * 获取或设置线性速度的因子，可以用来控制每个轴方向上的速度的缩放。
     */
    @visible(isDynamicBody)
    @displayOrder(6)
    @tooltip('i18n:physics3d.rigidbody.linearFactor')
    public get linearFactor (): Vec3 {
        return this._linearFactor;
    }

    public set linearFactor (value: Vec3) {
        Vec3.copy(this._linearFactor, value);
        this._applyLinearConstraints();
    }

    /**
     * @en
     * Gets or sets the rotation speed factor that can be used to control the scaling of the rotation speed in each axis direction.
     * @zh
     * 获取或设置旋转速度的因子，可以用来控制每个轴方向上的旋转速度的缩放。
     */
    @visible(isDynamicBody)
    @displayOrder(7)
    @tooltip('i18n:physics3d.rigidbody.angularFactor')
    public get angularFactor (): Vec3 {
        return this._angularFactor;
    }

    public set angularFactor (value: Vec3) {
        Vec3.copy(this._angularFactor, value);
        this._applyAngularConstraints();
    }

    /**
     * @en
     * Gets or sets the speed threshold for going to sleep.
     * @zh
     * 获取或设置进入休眠的速度临界值。
     */
    @visible(isDynamicBody)
    @displayOrder(8)
    @tooltip('i18n:physics3d.rigidbody.sleepThreshold')
    public get sleepThreshold (): number {
        return this._sleepThreshold;
    }

    public set sleepThreshold (v: number) {
        this._sleepThreshold = Math.max(0, v);
        if (this._body) this._body.setSleepThreshold(this._sleepThreshold);
    }

    /**
     * @en
     * Turning on or off continuous collision detection.
     * @zh
     * 开启或关闭连续碰撞检测。
     */
    @visible(isDynamicBody)
    @displayOrder(9)
    @tooltip('i18n:physics3d.rigidbody.useCCD')
    public get useCCD (): boolean {
        return this._useCCD;
    }

    public set useCCD (v: boolean) {
        this._useCCD = v;
        if (this._body) this._body.useCCD(v);
    }

    /**
     * @en
     * Gets whether it is the state of awake.
     * @zh
     * 获取是否是唤醒的状态。
     */
    public get isAwake (): boolean {
        if (this._isInitialized) return this._body!.isAwake;
        return false;
    }

    /**
     * @en
     * Gets whether you can enter a dormant state.
     * @zh
     * 获取是否是可进入休眠的状态。
     */
    public get isSleepy (): boolean {
        if (this._isInitialized) return this._body!.isSleepy;
        return false;
    }

    /**
     * @en
     * Gets whether the state is dormant.
     * @zh
     * 获取是否是正在休眠的状态。
     */
    public get isSleeping (): boolean {
        if (this._isInitialized) return this._body!.isSleeping;
        return false;
    }

    /**
     * @en
     * Gets or sets whether the rigid body is static.
     * @zh
     * 获取或设置刚体是否是静态类型的（静止不动的）。
     */
    public get isStatic (): boolean {
        return this._type === ERigidBodyType.STATIC;
    }

    public set isStatic (v: boolean) {
        if ((v && this.isStatic) || (!v && !this.isStatic)) return;
        this.type = v ? ERigidBodyType.STATIC : ERigidBodyType.DYNAMIC;
    }

    /**
     * @en
     * Gets or sets whether the rigid body moves through physical dynamics.
     * @zh
     * 获取或设置刚体是否是动力学态类型的（将根据物理动力学控制运动）。
     */
    public get isDynamic (): boolean {
        return this._type === ERigidBodyType.DYNAMIC;
    }

    public set isDynamic (v: boolean) {
        if ((v && this.isDynamic) || (!v && !this.isDynamic)) return;
        this.type = v ? ERigidBodyType.DYNAMIC : ERigidBodyType.KINEMATIC;
    }

    /**
     * @en
     * Gets or sets whether a rigid body is controlled by users.
     * @zh
     * 获取或设置刚体是否是运动态类型的（将由用户来控制运动）。
     */
    public get isKinematic (): boolean {
        return this._type === ERigidBodyType.KINEMATIC;
    }

    public set isKinematic (v: boolean) {
        if ((v && this.isKinematic) || (!v && !this.isKinematic)) return;
        this.type = v ? ERigidBodyType.KINEMATIC : ERigidBodyType.DYNAMIC;
    }

    /**
     * @en
     * Gets the wrapper object, through which the lowLevel instance can be accessed.
     * @zh
     * 获取封装对象，通过此对象可以访问到底层实例。
     */
    public get body (): IRigidBody | null {
        return this._body;
    }

    private _body: IRigidBody | null = null;

    /// PRIVATE PROPERTY ///

    @serializable
    private _group: number = PhysicsSystem.PhysicsGroup.DEFAULT;

    @serializable
    private _type: ERigidBodyType = ERigidBodyType.DYNAMIC;

    @serializable
    private _mass = 1;

    @serializable
    private _allowSleep = true;

    @serializable
    private _linearDamping = 0.1;

    @serializable
    private _angularDamping = 0.1;

    @serializable
    private _useGravity = true;

    @serializable
    private _gravityScale = 1;

    @serializable
    private _automaticCenterOfMass = true;

    @serializable
    private readonly _centerOfMass = new Vec3();

    @serializable
    private _freezePositionX = false;
    @serializable
    private _freezePositionY = false;
    @serializable
    private _freezePositionZ = false;

    @serializable
    private _freezeRotationX = false;
    @serializable
    private _freezeRotationY = false;
    @serializable
    private _freezeRotationZ = false;

    @serializable
    private _sleepThreshold = 0.1;

    @serializable
    private _useCCD = false;

    private readonly _effectiveLinearFactor = new Vec3(1, 1, 1);
    private readonly _effectiveAngularFactor = new Vec3(1, 1, 1);

    @serializable
    private _linearFactor: Vec3 = new Vec3(1, 1, 1);

    @serializable
    private _angularFactor: Vec3 = new Vec3(1, 1, 1);

    protected get _isInitialized (): boolean {
        const r = this._body === null;
        if (r) { error('[Physics]: This component has not been call onLoad yet, please make sure the node has been added to the scene.'); }
        return !r;
    }

    /// COMPONENT LIFECYCLE ///

    protected onLoad (): void {
        if (!selector.runInEditor) return;
        this._body = createRigidBody();
        this._body.initialize(this);
    }

    protected onEnable (): void {
        if (!this._body) return;
        this._body.onEnable!();
        this._applyGravitySettings();
        this._applyLinearConstraints();
        this._applyAngularConstraints();
        this._body.setSleepThreshold(this._sleepThreshold);
        this._body.useCCD(this._useCCD);
        if (this._body.setAutomaticCenterOfMass) this._body.setAutomaticCenterOfMass(this._automaticCenterOfMass);
        if (!this._automaticCenterOfMass && this._body.setCenterOfMass) this._body.setCenterOfMass(this._centerOfMass);
    }

    protected onDisable (): void {
        if (this._body) this._body.onDisable!();
    }

    protected onDestroy (): void {
        if (this._body) this._body.onDestroy!();
    }

    /**
     * @en Whether the active backend has exact custom center-of-mass support.
     * @zh 当前物理后端是否精确支持自定义质心。
     */
    public get supportsCenterOfMass (): boolean {
        return getPhysicsBackendCapabilities().centerOfMass;
    }

    public get supportsGravityScale (): boolean {
        return getPhysicsBackendCapabilities().gravityScale;
    }

    private _applyGravitySettings (): void {
        if (!this._body) return;
        const effectiveScale = this._useGravity ? this._gravityScale : 0;
        if (this._body.setGravityScale) {
            this._body.setGravityScale(effectiveScale);
        } else {
            this._body.useGravity(effectiveScale !== 0);
        }
    }

    private _applyLinearConstraints (): void {
        if (!this._body) return;
        this._effectiveLinearFactor.set(
            this._freezePositionX ? 0 : this._linearFactor.x,
            this._freezePositionY ? 0 : this._linearFactor.y,
            this._freezePositionZ ? 0 : this._linearFactor.z,
        );
        this._body.setLinearFactor(this._effectiveLinearFactor);
    }

    private _applyAngularConstraints (): void {
        if (!this._body) return;
        this._effectiveAngularFactor.set(
            this._freezeRotationX ? 0 : this._angularFactor.x,
            this._freezeRotationY ? 0 : this._angularFactor.y,
            this._freezeRotationZ ? 0 : this._angularFactor.z,
        );
        this._body.setAngularFactor(this._effectiveAngularFactor);
    }

    /// PUBLIC METHOD ///

    /**
     * @en
     * Apply force to a world point. This could, for example, be a point on the Body surface.
     * @zh
     * 在世界空间中，相对于刚体的质心的某点上对刚体施加作用力。
     * @param force @zh 作用力 @en The force applied
     * @param relativePoint @zh 作用点，相对于刚体的质心 @en The point to apply the force on, relative to the center of mass of the rigid body
     */
    public applyForce (force: Vec3, relativePoint?: Vec3): void {
        if (this._isInitialized) this._body!.applyForce(force, relativePoint);
    }

    /**
     * @en
     * Apply force to a local point. This could, for example, be a point on the Body surface.
     * @zh
     * 在本地空间中，相对于刚体的质心的某点上对刚体施加作用力。
     * @param force @zh 作用力 @en The force applied
     * @param localPoint @zh 作用点 @en The point to apply the force on
     */
    public applyLocalForce (force: Vec3, localPoint?: Vec3): void {
        if (this._isInitialized) this._body!.applyLocalForce(force, localPoint);
    }

    /**
     * @en
     * In world space, impulse is applied to the rigid body at some point relative to the center of mass of the rigid body.
     * @zh
     * 在世界空间中，相对于刚体的质心的某点上对刚体施加冲量。
     * @param impulse @zh 冲量 @en The impulse applied
     * @param relativePoint @zh 作用点，相对于刚体的中心点 @en The point to apply the impulse, relative to the center of mass of the rigid body
     */
    public applyImpulse (impulse: Vec3, relativePoint?: Vec3): void {
        if (this._isInitialized) this._body!.applyImpulse(impulse, relativePoint);
    }

    /**
     * @en
     * In local space, impulse is applied to the rigid body at some point relative to the center of mass of the rigid body.
     * @zh
     * 在本地空间中，相对于刚体的质心的某点上对刚体施加冲量。
     * @param impulse @zh 冲量 @en The impulse applied
     * @param localPoint @zh 作用点 @en The point to apply the impulse
     */
    public applyLocalImpulse (impulse: Vec3, localPoint?: Vec3): void {
        if (this._isInitialized) this._body!.applyLocalImpulse(impulse, localPoint);
    }

    /**
     * @en
     * In world space, torque is applied to the rigid body.
     * @zh
     * 在世界空间中，对刚体施加扭矩。
     * @param torque @zh 扭矩 @en The torque applied
     */
    public applyTorque (torque: Vec3): void {
        if (this._isInitialized) this._body!.applyTorque(torque);
    }

    /**
     * @zh
     * 在本地空间中，对刚体施加扭矩。
     * @zh
     * In local space, torque is applied to the rigid body.
     * @param torque @zh 扭矩 @en The torque applied
     */
    public applyLocalTorque (torque: Vec3): void {
        if (this._isInitialized) this._body!.applyLocalTorque(torque);
    }

    /**
     * @en
     * Wake up the rigid body.
     * @zh
     * 唤醒刚体。
     */
    public wakeUp (): void {
        if (this._isInitialized) this._body!.wakeUp();
    }

    /**
     * @en
     * Dormancy of rigid body.
     * @zh
     * 休眠刚体。
     */
    public sleep (): void {
        if (this._isInitialized) this._body!.sleep();
    }

    /**
     * @en
     * Clear the forces and velocity of the rigid body.
     * @zh
     * 清除刚体受到的力和速度。
     */
    public clearState (): void {
        if (this._isInitialized) this._body!.clearState();
    }

    /**
     * @en
     * Clear the forces of the rigid body.
     * @zh
     * 清除刚体受到的力。
     */
    public clearForces (): void {
        if (this._isInitialized) this._body!.clearForces();
    }

    /**
     * @en
     * Clear velocity of the rigid body.
     * @zh
     * 清除刚体的速度。
     */
    public clearVelocity (): void {
        if (this._isInitialized) this._body!.clearVelocity();
    }

    /**
     * @en
     * Gets the linear velocity.
     * @zh
     * 获取线性速度。
     * @param out @zh 速度向量 @en The velocity vector
     */
    public getLinearVelocity (out: Vec3): void {
        if (this._isInitialized) this._body!.getLinearVelocity(out);
    }

    /**
     * @en
     * Sets the linear velocity.
     * @zh
     * 设置线性速度。
     * @param value @zh 速度向量 @en The velocity vector
     */
    public setLinearVelocity (value: Vec3): void {
        if (this._isInitialized) this._body!.setLinearVelocity(value);
    }

    /**
     * @en
     * Gets the angular velocity.
     * @zh
     * 获取旋转速度。
     * @param out @zh 角速度向量 @en The angular velocity vector
     */
    public getAngularVelocity (out: Vec3): void {
        if (this._isInitialized) this._body!.getAngularVelocity(out);
    }

    /**
     * @en
     * Sets the angular velocity.
     * @zh
     * 设置旋转速度。
     * @param value @zh 角速度向量 @en The angular velocity vector
     */
    public setAngularVelocity (value: Vec3): void {
        if (this._isInitialized) this._body!.setAngularVelocity(value);
    }

    /// GROUP MASK ///

    /**
     * @en
     * Gets the group value.
     * @zh
     * 获取分组值。
     * @returns @zh 分组值，为 32 位整数，范围为 [2^0, 2^31] @en Group value which is a 32-bits integer, the range is [2^0, 2^31]
     */
    public getGroup (): number {
        if (this._isInitialized) return this._body!.getGroup();
        return 0;
    }

    /**
     * @en
     * Sets the group value.
     * @zh
     * 设置分组值。
     * @param v @zh 分组值，为 32 位整数，范围为 [2^0, 2^31] @en Group value which is a 32-bits integer, the range is [2^0, 2^31]
     */
    public setGroup (v: number): void {
        if (this._isInitialized) this._body!.setGroup(v);
    }

    /**
     * @en
     * Add a grouping value to fill in the group you want to join.
     * @zh
     * 添加分组值，可填要加入的 group。
     * @param v @zh 分组值，为 32 位整数，范围为 [2^0, 2^31] @en Group value which is a 32-bits integer, the range is [2^0, 2^31]
     */
    public addGroup (v: number): void {
        if (this._isInitialized) this._body!.addGroup(v);
    }

    /**
     * @en
     * Subtract the grouping value to fill in the group to be removed.
     * @zh
     * 减去分组值，可填要移除的 group。
     * @param v @zh 分组值，为 32 位整数，范围为 [2^0, 2^31] @en Group value which is a 32-bits integer, the range is [2^0, 2^31]
     */
    public removeGroup (v: number): void {
        if (this._isInitialized) this._body!.removeGroup(v);
    }

    /**
     * @en
     * Gets the mask value.
     * @zh
     * 获取掩码值。
     * @returns {number} @zh 掩码值，为 32 位整数，范围为 [2^0, 2^31] @en Mask value which is a 32-bits integer, the range is [2^0, 2^31]
     */
    public getMask (): number {
        if (this._isInitialized) return this._body!.getMask();
        return 0;
    }

    /**
     * @en
     * Sets the mask value.
     * @zh
     * 设置掩码值。
     * @param v @zh 掩码值，为 32 位整数，范围为 [2^0, 2^31] @en Mask value which is a 32-bits integer, the range is [2^0, 2^31]
     */
    public setMask (v: number): void {
        if (this._isInitialized) this._body!.setMask(v);
    }

    /**
     * @en
     * Add mask values to fill in groups that need to be checked.
     * @zh
     * 添加掩码值，可填入需要检查的 group。
     * @param v @zh 掩码值，为 32 位整数，范围为 [2^0, 2^31] @en Mask value which is a 32-bits integer, the range is [2^0, 2^31]
     */
    public addMask (v: number): void {
        if (this._isInitialized) this._body!.addMask(v);
    }

    /**
     * @en
     * Subtract the mask value to fill in the group that does not need to be checked.
     * @zh
     * 减去掩码值，可填入不需要检查的 group。
     * @param v @zh 掩码值，为 32 位整数，范围为 [2^0, 2^31] @en Mask value which is a 32-bits integer, the range is [2^0, 2^31]
     */
    public removeMask (v: number): void {
        if (this._isInitialized) this._body!.removeMask(v);
    }
}

function isDynamicBody (this: RigidBody): boolean { return this.isDynamic; }

export namespace RigidBody {
    export type Type = EnumAlias<typeof ERigidBodyType>;
}
