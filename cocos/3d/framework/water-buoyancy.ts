/*
 Copyright (c) 2026 KropAl-Playable
*/

import { Color, Vec3, _decorator, CCFloat, CCInteger, cclegacy } from '../../core';
import { Component } from '../../scene-graph';
import { computeBuoyancyForceY } from '../misc/water-buoyancy';
import { IWorldWaterSample, WaterSurface } from './water-surface';

const { ccclass, menu, property, range } = _decorator;

interface IRigidBodyLike {
    isDynamic: boolean;
    getLinearVelocity(out: Vec3): void;
    getAngularVelocity(out: Vec3): void;
    applyImpulse(impulse: Vec3, relativePoint?: Vec3): void;
    wakeUp(): void;
}

const _linearVelocity = new Vec3();
const _angularVelocity = new Vec3();
const _worldPoint = new Vec3();
const _relativePoint = new Vec3();
const _angularPointVelocity = new Vec3();
const _pointVelocity = new Vec3();
const _impulse = new Vec3();
const _waterLine = new Vec3();
const _normalEnd = new Vec3();

const DEBUG_DRY = new Color(255, 96, 64, 255);
const DEBUG_WET = new Color(64, 255, 128, 255);
const DEBUG_WATER = new Color(64, 200, 255, 255);
const DEBUG_NORMAL = new Color(255, 230, 64, 255);

function createWorldSample(): IWorldWaterSample {
    return {
        height: 0,
        position: new Vec3(),
        normal: new Vec3(0, 1, 0),
        velocity: new Vec3(),
    };
}

/**
 * Lightweight multi-point buoyancy driven by WaterSurface.sampleWater().
 *
 * The component intentionally depends only on the public RigidBody API shape,
 * not a concrete physics backend. Four sample points are enough to produce
 * stable pitch/roll for crates, rafts and small boats.
 */
@ccclass('cc.WaterBuoyancy')
@menu('Physics/WaterBuoyancy')
export class WaterBuoyancy extends Component {
    @property({ type: WaterSurface })
    public water: WaterSurface | null = null;

    @property({ type: CCInteger })
    @range([1, 4, 1])
    public sampleCount = 4;

    @property
    public sample0 = new Vec3(-0.5, -0.25, 0.75);

    @property
    public sample1 = new Vec3(0.5, -0.25, 0.75);

    @property
    public sample2 = new Vec3(-0.5, -0.25, -0.75);

    @property
    public sample3 = new Vec3(0.5, -0.25, -0.75);

    @property({ type: CCFloat })
    @range([0, 100, 0.1])
    public buoyancy = 12.5;

    @property({ type: CCFloat })
    @range([0, 50, 0.1])
    public verticalDamping = 4.0;

    @property({ type: CCFloat })
    @range([0.01, 10, 0.01])
    public maxSubmersion = 1.0;

    @property({ type: CCFloat })
    @range([0, 250, 0.1])
    public maxForcePerPoint = 50.0;

    @property
    public debugDraw = false;

    @property({ type: CCFloat })
    @range([0.01, 2, 0.01])
    public debugNormalLength = 0.3;

    private _body: IRigidBodyLike | null = null;
    private _warnedMissingBody = false;
    private _samples: IWorldWaterSample[] = [
        createWorldSample(),
        createWorldSample(),
        createWorldSample(),
        createWorldSample(),
    ];
    private _depths = [0, 0, 0, 0];
    private _settings = {
        buoyancy: 12.5,
        damping: 4.0,
        maxForce: 50.0,
        maxSubmersion: 1.0,
    };

    protected onEnable(): void {
        // Keep this component physics-backend agnostic. Any standard Cocos
        // RigidBody implementation exposes this public API.
        this._body = this.getComponent('cc.RigidBody') as unknown as IRigidBodyLike | null;
        this._warnedMissingBody = false;
    }

    protected update(dt: number): void {
        if (!this.water || !this.isValid) return;

        if (!this._body) {
            this._body = this.getComponent('cc.RigidBody') as unknown as IRigidBodyLike | null;
            if (!this._body) {
                if (!this._warnedMissingBody) {
                    this._warnedMissingBody = true;
                    console.warn(`[WaterBuoyancy] ${this.node.name}: add a dynamic cc.RigidBody to enable buoyancy.`);
                }
                if (this.debugDraw) this._sampleOnly();
                return;
            }
        }

        if (!this._body.isDynamic) {
            if (this.debugDraw) this._sampleOnly();
            return;
        }

        const frameDt = Math.max(0, Math.min(dt, 0.05));
        if (frameDt <= 0) return;

        this._body.getLinearVelocity(_linearVelocity);
        this._body.getAngularVelocity(_angularVelocity);

        this._settings.buoyancy = this.buoyancy;
        this._settings.damping = this.verticalDamping;
        this._settings.maxForce = this.maxForcePerPoint;
        this._settings.maxSubmersion = this.maxSubmersion;

        const count = Math.max(1, Math.min(4, Math.floor(this.sampleCount)));
        let applied = false;

        for (let i = 0; i < count; ++i) {
            const localPoint = this._getLocalPoint(i);
            Vec3.transformMat4(_worldPoint, localPoint, this.node.worldMatrix);
            const sample = this.water.sampleWater(_worldPoint, this._samples[i]);
            const depth = sample.height - _worldPoint.y;
            this._depths[i] = depth;

            if (depth <= 0) continue;

            Vec3.subtract(_relativePoint, _worldPoint, this.node.worldPosition);

            // v_point = v_linear + omega x r
            Vec3.cross(_angularPointVelocity, _angularVelocity, _relativePoint);
            Vec3.add(_pointVelocity, _linearVelocity, _angularPointVelocity);

            const relativeVerticalVelocity = _pointVelocity.y - sample.velocity.y;
            const forceY = computeBuoyancyForceY(depth, relativeVerticalVelocity, this._settings);
            if (forceY <= 0) continue;

            _impulse.set(0, forceY * frameDt, 0);
            this._body.applyImpulse(_impulse, _relativePoint);
            applied = true;
        }

        if (applied) this._body.wakeUp();
        if (this.debugDraw) this._drawDebug(count);
    }

    private _sampleOnly(): void {
        if (!this.water) return;
        const count = Math.max(1, Math.min(4, Math.floor(this.sampleCount)));
        for (let i = 0; i < count; ++i) {
            Vec3.transformMat4(_worldPoint, this._getLocalPoint(i), this.node.worldMatrix);
            const sample = this.water.sampleWater(_worldPoint, this._samples[i]);
            this._depths[i] = sample.height - _worldPoint.y;
        }
        this._drawDebug(count);
    }

    private _getLocalPoint(index: number): Vec3 {
        switch (index) {
        case 0: return this.sample0;
        case 1: return this.sample1;
        case 2: return this.sample2;
        default: return this.sample3;
        }
    }

    private _drawDebug(count: number): void {
        const root = cclegacy.director.root as any;
        const cameras = root?.cameraList as any[] | undefined;
        if (!cameras?.length) return;

        for (const camera of cameras) {
            camera.initGeometryRenderer?.();
            const geometryRenderer = camera.geometryRenderer;
            if (!geometryRenderer) continue;

            for (let i = 0; i < count; ++i) {
                Vec3.transformMat4(_worldPoint, this._getLocalPoint(i), this.node.worldMatrix);
                const sample = this._samples[i];
                const submerged = this._depths[i] > 0;
                const pointColor = submerged ? DEBUG_WET : DEBUG_DRY;

                geometryRenderer.addCross(_worldPoint, 0.06, pointColor, true);

                _waterLine.set(_worldPoint.x, sample.height, _worldPoint.z);
                geometryRenderer.addLine(_worldPoint, _waterLine, DEBUG_WATER, true);
                geometryRenderer.addCross(_waterLine, 0.045, DEBUG_WATER, true);

                Vec3.scaleAndAdd(_normalEnd, sample.position, sample.normal, this.debugNormalLength);
                geometryRenderer.addLine(sample.position, _normalEnd, DEBUG_NORMAL, true);
            }
        }
    }
}

cclegacy.WaterBuoyancy = WaterBuoyancy;
