/*
 Copyright (c) 2026 KropAl-Playable
*/

import { EDITOR } from 'internal:constants';
import { Color, Vec2, Vec3, Vec4, _decorator, CCFloat, CCInteger, cclegacy } from '../../core';
import { Component, Node } from '../../scene-graph';
import { MeshRenderer } from './mesh-renderer';
import {
    createWaterSample,
    IWaterSample,
    IWaterWave,
    MAX_WATER_WAVES,
    sampleGerstnerWaves,
} from '../misc/water-wave';

const { ccclass, executeInEditMode, menu, property, range } = _decorator;

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
    @range([0, 1, 0.001])
    public crestSharpness = 0.25;

    @property({ type: CCFloat })
    public phase = 0;

}

function createWaterWave(
    direction: Readonly<Vec2>,
    amplitude: number,
    wavelength: number,
    speed: number,
    steepness: number,
    phase: number,
    crestSharpness = 0.25,
): WaterWave {
    // Keep WaterWave itself constructor-free. Creator's scene deserializer is
    // most reliable for nested serializable classes when it can instantiate
    // them with the engine default constructor in both Editor and browser builds.
    const wave = new WaterWave();
    wave.direction.set(direction);
    wave.amplitude = amplitude;
    wave.wavelength = wavelength;
    wave.speed = speed;
    wave.steepness = steepness;
    wave.phase = phase;
    wave.crestSharpness = crestSharpness;
    return wave;
}

const _localSample = createWaterSample();
const _worldPosition = new Vec3();
const _worldNormal = new Vec3();
const _worldVelocity = new Vec3();
const _probeInputLocal = new Vec3();
const _probeInputWorld = new Vec3();
const _probeNormalEnd = new Vec3();
const _debugProbeSample: IWorldWaterSample = {
    height: 0,
    position: new Vec3(),
    normal: new Vec3(0, 1, 0),
    velocity: new Vec3(),
};
const DEBUG_PROBE_COLOR = new Color(255, 220, 0, 255);
const DEBUG_NORMAL_COLOR = new Color(0, 255, 255, 255);
const MAX_WATER_WAKE_SOURCES = 5;

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
export class WaterSurface extends Component {
    @property({ type: CCInteger })
    @range([1, MAX_WATER_WAVES, 1])
    public waveCount = 3;

    @property({ type: WaterWave })
    public wave0 = createWaterWave(new Vec2(1, 0.15), 0.18, 4.5, 1.0, 0.35, 0);

    @property({ type: WaterWave })
    public wave1 = createWaterWave(new Vec2(-0.45, 1), 0.10, 2.8, 0.72, 0.28, 1.7);

    @property({ type: WaterWave })
    public wave2 = createWaterWave(new Vec2(0.7, 0.55), 0.055, 1.6, 0.48, 0.20, 3.4);

    @property({ type: WaterWave })
    public wave3 = createWaterWave(new Vec2(-0.8, -0.3), 0.035, 0.95, 0.34, 0.16, 5.1);

    @property({ type: CCFloat })
    @range([0, 4, 0.01])
    public timeScale = 1;

    @property
    public previewInEditor = true;

    @property
    public includeChildRenderers = true;

    @property({ type: Node })
    public debugProbe: Node | null = null;

    @property
    public debugProbeLocalXZ = new Vec2(0, 0);

    @property
    public debugDrawProbe = false;

    @property({ type: CCFloat })
    @range([0.01, 5, 0.01])
    public debugNormalLength = 0.5;

    private _renderers: MeshRenderer[] = [];
    private _time = 0;
    private _materialInstances: ReturnType<MeshRenderer['getMaterialInstance']>[] = [];
    private _waveDirAmp: Vec4[] = [new Vec4(), new Vec4(), new Vec4(), new Vec4()];
    private _waveParams: Vec4[] = [new Vec4(), new Vec4(), new Vec4(), new Vec4()];
    private _waveShape = new Vec4();
    private _timeParams = new Vec4();

    private _wakeData: Vec4[] = [new Vec4(), new Vec4(), new Vec4(), new Vec4(), new Vec4()];
    private _wakeIntensities = new Vec4();
    private _wakeIntensity4 = 0;
    private _materialRefreshCounter = 0;

    public get time(): number {
        return this._time;
    }

    public get waves(): readonly WaterWave[] {
        return [this.wave0, this.wave1, this.wave2, this.wave3];
    }

    protected onEnable(): void {
        this._collectRenderers();
        this._collectMaterials();
        this._uploadWaves();
    }

    protected onDisable(): void {
        this._materialInstances.length = 0;
    }

    protected update(dt: number): void {
        if (EDITOR && !this.previewInEditor) {
            this._uploadWaves();
            this._updateDebugProbe();
            return;
        }
        this._time += Math.max(0, Math.min(dt, 0.1)) * this.timeScale;
        this._uploadWaves();
        this._updateDebugProbe();
    }

    /**
     * Updates one of five bounded visual wake sources.
     *
     * Position and direction are world-space because the current stylized water
     * fragment shader evaluates wakes against v_position.xz.
     */
    public setWakeSource(
        index: number,
        worldPosition: Readonly<Vec3>,
        worldDirection: Readonly<Vec3>,
        intensity = 1,
    ): void {
        const i = Math.max(0, Math.min(MAX_WATER_WAKE_SOURCES - 1, Math.floor(index)));
        const length = Math.sqrt(
            worldDirection.x * worldDirection.x
            + worldDirection.z * worldDirection.z,
        );
        const invLength = length > 1e-6 ? 1 / length : 0;
        this._wakeData[i].set(
            worldPosition.x,
            worldPosition.z,
            worldDirection.x * invLength,
            worldDirection.z * invLength,
        );
        const value = Math.max(0, Math.min(1, intensity));
        if (i < 4) {
            if (i === 0) this._wakeIntensities.x = value;
            else if (i === 1) this._wakeIntensities.y = value;
            else if (i === 2) this._wakeIntensities.z = value;
            else this._wakeIntensities.w = value;
        } else {
            this._wakeIntensity4 = value;
        }
        this._uploadWakes();
    }

    public clearWakeSource(index: number): void {
        const i = Math.max(0, Math.min(MAX_WATER_WAKE_SOURCES - 1, Math.floor(index)));
        if (i < 4) {
            if (i === 0) this._wakeIntensities.x = 0;
            else if (i === 1) this._wakeIntensities.y = 0;
            else if (i === 2) this._wakeIntensities.z = 0;
            else this._wakeIntensities.w = 0;
        } else {
            this._wakeIntensity4 = 0;
        }
        this._uploadWakes();
    }

    public clearWakeSources(): void {
        this._wakeIntensities.set(0, 0, 0, 0);
        this._wakeIntensity4 = 0;
        this._uploadWakes();
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

        const count = Math.max(1, Math.min(MAX_WATER_WAVES, Math.floor(this.waveCount)));
        const waves = this.waves;

        // Waves are parameterized in world XZ so multiple translated tiles share
        // one continuous analytical surface. Invert the horizontal Gerstner
        // displacement to answer a query at the visible world-space XZ.
        const targetX = worldPosition.x;
        const targetZ = worldPosition.z;
        let queryX = targetX;
        let queryZ = targetZ;
        for (let i = 0; i < 3; ++i) {
            sampleGerstnerWaves(queryX, queryZ, this._time, waves, _localSample, count);
            queryX -= _localSample.position.x - targetX;
            queryZ -= _localSample.position.z - targetZ;
        }
        sampleGerstnerWaves(queryX, queryZ, this._time, waves, _localSample, count);

        const baseY = this.node.worldPosition.y;
        _worldPosition.set(_localSample.position.x, baseY + _localSample.position.y, _localSample.position.z);
        _worldNormal.set(_localSample.normal);
        _worldVelocity.set(_localSample.velocity);

        result.height = _worldPosition.y;
        result.position.set(_worldPosition);
        result.normal.set(_worldNormal);
        result.velocity.set(_worldVelocity);
        return result;
    }

    private _updateDebugProbe(): void {
        if (!this.debugProbe && !this.debugDrawProbe) return;

        // Keep the parameter-space XZ fixed. Using the marker's displaced XZ as
        // the next input would introduce artificial drift with Gerstner waves.
        _probeInputWorld.set(
            this.node.worldPosition.x + this.debugProbeLocalXZ.x,
            this.node.worldPosition.y,
            this.node.worldPosition.z + this.debugProbeLocalXZ.y,
        );
        this.sampleWater(_probeInputWorld, _debugProbeSample);

        if (this.debugProbe) {
            this.debugProbe.setWorldPosition(_debugProbeSample.position);
        }

        if (!this.debugDrawProbe) return;
        Vec3.scaleAndAdd(
            _probeNormalEnd,
            _debugProbeSample.position,
            _debugProbeSample.normal,
            this.debugNormalLength,
        );

        const root = cclegacy.director.root as any;
        const cameras = root?.cameraList as any[] | undefined;
        if (!cameras?.length) return;
        for (const camera of cameras) {
            camera.initGeometryRenderer?.();
            const geometryRenderer = camera.geometryRenderer;
            if (!geometryRenderer) continue;
            geometryRenderer.addCross(_debugProbeSample.position, 0.08, DEBUG_PROBE_COLOR, true);
            geometryRenderer.addLine(
                _debugProbeSample.position,
                _probeNormalEnd,
                DEBUG_NORMAL_COLOR,
                true,
            );
        }
    }

    private _collectRenderers(): void {
        this._renderers.length = 0;
        if (this.includeChildRenderers) {
            const renderers = this.getComponentsInChildren(MeshRenderer);
            for (const renderer of renderers) {
                if (renderer && renderer.isValid) this._renderers.push(renderer);
            }
        } else {
            const renderer = this.getComponent(MeshRenderer);
            if (renderer) this._renderers.push(renderer);
        }
    }

    private _collectMaterials(): void {
        this._materialInstances.length = 0;
        this._collectRenderers();

        for (const renderer of this._renderers) {
            for (let i = 0; i < renderer.sharedMaterials.length; ++i) {
                const material = renderer.getMaterialInstance(i);
                if (!material || !material.isValid) continue;

                let supportsWater = false;
                for (const pass of material.passes) {
                    if (pass.getHandle('waterWaveTime')) {
                        supportsWater = true;
                        break;
                    }
                }
                if (!supportsWater) continue;
                if (this._materialInstances.includes(material)) continue;
                this._materialInstances.push(material);
            }
        }

        // A newly-created material instance starts from effect defaults. Reapply
        // component-owned state immediately so editor edits/reimports cannot
        // silently restore default waves.
        this._uploadWakes();
    }

    private _uploadWaves(): void {
        // Creator may recreate MaterialInstance objects after editing/reimporting
        // a material. Cached instances then keep receiving uniforms while the
        // renderer uses a fresh instance, which looks like a frozen/default wave.
        // Refresh aggressively in Editor and occasionally at runtime.
        if (EDITOR || !this._materialInstances.length || (++this._materialRefreshCounter % 120) === 0) {
            this._collectMaterials();
        }

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
        this._waveShape.set(
            Math.max(0, Math.min(1, waves[0].crestSharpness)),
            Math.max(0, Math.min(1, waves[1].crestSharpness)),
            Math.max(0, Math.min(1, waves[2].crestSharpness)),
            Math.max(0, Math.min(1, waves[3].crestSharpness)),
        );
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
                const shapeHandle = pass.getHandle('waterWaveShape');
                if (shapeHandle) pass.setUniform(shapeHandle, this._waveShape);
                const timeHandle = pass.getHandle('waterWaveTime');
                if (timeHandle) pass.setUniform(timeHandle, this._timeParams);
            }
        }
    }

    private _uploadWakes(): void {
        if (!this._materialInstances.length) return;

        for (const material of this._materialInstances) {
            if (!material || !material.isValid) continue;
            for (const pass of material.passes) {
                for (let i = 0; i < MAX_WATER_WAKE_SOURCES; ++i) {
                    const handle = pass.getHandle(`dynamicWakeData${i}`);
                    if (handle) pass.setUniform(handle, this._wakeData[i]);
                }
                const intensitiesHandle = pass.getHandle('dynamicWakeIntensities');
                if (intensitiesHandle) pass.setUniform(intensitiesHandle, this._wakeIntensities);
                const intensity4Handle = pass.getHandle('dynamicWakeIntensity4');
                if (intensity4Handle) pass.setUniform(intensity4Handle, this._wakeIntensity4);
            }
        }
    }
}

cclegacy.WaterWave = WaterWave;
cclegacy.WaterSurface = WaterSurface;
