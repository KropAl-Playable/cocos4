/*
 Copyright (c) 2026 KropAl-Playable
*/

import { EDITOR } from 'internal:constants';
import { Mat4, Vec2, Vec3, Vec4, _decorator, CCFloat, CCInteger, cclegacy } from '../../core';
import { Component } from '../../scene-graph';
import { MeshRenderer } from './mesh-renderer';
import {
    createWaterSample,
    IWaterSample,
    IWaterWave,
    MAX_WATER_WAVES,
    sampleGerstnerWaves,
} from '../misc/water-wave';

const { ccclass, executeInEditMode, menu, property, requireComponent, range } = _decorator;

@ccclass('cc.WaterWave')
export class WaterWave implements IWaterWave {
    @property
    public direction = new Vec2(1, 0);

    @property({ type: CCFloat })
    @range([0, 5, 0.001])
    public amplitude = 0.15;

    @property({ type: CCFloat })
    @range([0.05, 100, 0.01])
    public wavelength = 4;

    @property({ type: CCFloat })
    @range([-20, 20, 0.01])
    public speed = 1;

    @property({ type: CCFloat })
    @range([0, 1, 0.001])
    public steepness = 0.35;

    @property({ type: CCFloat })
    public phase = 0;

    constructor(
        direction = new Vec2(1, 0),
        amplitude = 0.15,
        wavelength = 4,
        speed = 1,
        steepness = 0.35,
        phase = 0,
    ) {
        this.direction.set(direction);
        this.amplitude = amplitude;
        this.wavelength = wavelength;
        this.speed = speed;
        this.steepness = steepness;
        this.phase = phase;
    }
}

const _inverseWorld = new Mat4();
const _localPoint = new Vec3();
const _localSample = createWaterSample();
const _worldPosition = new Vec3();
const _worldNormal = new Vec3();
const _worldVelocity = new Vec3();

export interface IWorldWaterSample {
    height: number;
    position: Vec3;
    normal: Vec3;
    velocity: Vec3;
}

/**
 * Authoritative analytical water source for both GPU presentation and CPU gameplay.
 *
 * v0.1 evaluates waves in this node's local XZ plane. Translation, rotation and
 * scale are accounted for when sampling world positions. The renderer receives
 * exactly the same wave parameters and component-owned time.
 */
@ccclass('cc.WaterSurface')
@menu('Mesh/WaterSurface')
@executeInEditMode
@requireComponent(MeshRenderer)
export class WaterSurface extends Component {
    @property({ type: CCInteger })
    @range([1, MAX_WATER_WAVES, 1])
    public waveCount = 3;

    @property({ type: WaterWave })
    public wave0 = new WaterWave(new Vec2(1, 0.15), 0.18, 4.5, 1.0, 0.35, 0);

    @property({ type: WaterWave })
    public wave1 = new WaterWave(new Vec2(-0.45, 1), 0.10, 2.8, 0.72, 0.28, 1.7);

    @property({ type: WaterWave })
    public wave2 = new WaterWave(new Vec2(0.7, 0.55), 0.055, 1.6, 0.48, 0.20, 3.4);

    @property({ type: WaterWave })
    public wave3 = new WaterWave(new Vec2(-0.8, -0.3), 0.035, 0.95, 0.34, 0.16, 5.1);

    @property({ type: CCFloat })
    @range([0, 4, 0.01])
    public timeScale = 1;

    @property
    public previewInEditor = true;

    private _renderer: MeshRenderer | null = null;
    private _time = 0;
    private _materialInstances: ReturnType<MeshRenderer['getMaterialInstance']>[] = [];
    private _waveDirAmp: Vec4[] = [new Vec4(), new Vec4(), new Vec4(), new Vec4()];
    private _waveParams: Vec4[] = [new Vec4(), new Vec4(), new Vec4(), new Vec4()];
    private _timeParams = new Vec4();

    public get time(): number {
        return this._time;
    }

    public get waves(): readonly WaterWave[] {
        return [this.wave0, this.wave1, this.wave2, this.wave3];
    }

    protected onEnable(): void {
        this._renderer = this.getComponent(MeshRenderer);
        this._collectMaterials();
        this._uploadWaves();
    }

    protected onDisable(): void {
        this._materialInstances.length = 0;
    }

    protected update(dt: number): void {
        if (EDITOR && !this.previewInEditor) {
            this._uploadWaves();
            return;
        }
        this._time += Math.max(0, Math.min(dt, 0.1)) * this.timeScale;
        this._uploadWaves();
    }

    public resetTime(time = 0): void {
        this._time = time;
        this._uploadWaves();
    }

    /**
     * Samples the gameplay surface at a world-space XZ position.
     * Returned height is world-space Y at the displaced analytical surface.
     */
    public sampleWater(worldPosition: Vec3, out?: IWorldWaterSample): IWorldWaterSample {
        const result = out || {
            height: 0,
            position: new Vec3(),
            normal: new Vec3(0, 1, 0),
            velocity: new Vec3(),
        };

        Mat4.invert(_inverseWorld, this.node.worldMatrix);
        Vec3.transformMat4(_localPoint, worldPosition, _inverseWorld);

        const count = Math.max(1, Math.min(MAX_WATER_WAVES, Math.floor(this.waveCount)));
        const waves = this.waves;
        sampleGerstnerWaves(_localPoint.x, _localPoint.z, this._time, waves, _localSample, count);

        Vec3.transformMat4(_worldPosition, _localSample.position, this.node.worldMatrix);
        Vec3.transformMat4Normal(_worldNormal, _localSample.normal, this.node.worldMatrix);
        Vec3.normalize(_worldNormal, _worldNormal);
        Vec3.transformMat4Normal(_worldVelocity, _localSample.velocity, this.node.worldMatrix);

        result.height = _worldPosition.y;
        result.position.set(_worldPosition);
        result.normal.set(_worldNormal);
        result.velocity.set(_worldVelocity);
        return result;
    }

    private _collectMaterials(): void {
        this._materialInstances.length = 0;
        if (!this._renderer) return;
        for (let i = 0; i < this._renderer.sharedMaterials.length; ++i) {
            const material = this._renderer.getMaterialInstance(i);
            if (!material) continue;
            const effectName = material.effectAsset?.name || '';
            if (!effectName.includes('playable-water')) continue;
            this._materialInstances.push(material);
        }
    }

    private _uploadWaves(): void {
        if (!this._renderer) return;
        if (!this._materialInstances.length) this._collectMaterials();

        const waves = this.waves;
        const count = Math.max(1, Math.min(MAX_WATER_WAVES, Math.floor(this.waveCount)));
        for (let i = 0; i < MAX_WATER_WAVES; ++i) {
            const wave = waves[i];
            const length = Math.sqrt(wave.direction.x * wave.direction.x + wave.direction.y * wave.direction.y);
            const invLength = length > 1e-6 ? 1 / length : 0;
            this._waveDirAmp[i].set(
                wave.direction.x * invLength,
                wave.direction.y * invLength,
                wave.amplitude,
                Math.max(0, Math.min(1, wave.steepness)),
            );
            this._waveParams[i].set(
                Math.max(Math.abs(wave.wavelength), 1e-6),
                wave.speed,
                wave.phase,
                i < count ? 1 : 0,
            );
        }
        this._timeParams.set(this._time, count, 0, 0);

        for (const material of this._materialInstances) {
            if (!material) continue;
            for (const pass of material.passes) {
                for (let i = 0; i < MAX_WATER_WAVES; ++i) {
                    let handle = pass.getHandle(`waterWaveDirAmp${i}`);
                    if (handle) pass.setUniform(handle, this._waveDirAmp[i]);
                    handle = pass.getHandle(`waterWaveParams${i}`);
                    if (handle) pass.setUniform(handle, this._waveParams[i]);
                }
                const timeHandle = pass.getHandle('waterWaveTime');
                if (timeHandle) pass.setUniform(timeHandle, this._timeParams);
            }
        }
    }
}

cclegacy.WaterWave = WaterWave;
cclegacy.WaterSurface = WaterSurface;
