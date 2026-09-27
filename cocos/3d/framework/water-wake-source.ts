/*
 Copyright (c) 2026 KropAl-Playable
*/

import { Vec3, _decorator, CCFloat, CCInteger, cclegacy } from '../../core';
import { Component } from '../../scene-graph';
import { WaterSurface } from './water-surface';

const { ccclass, menu, property, range } = _decorator;

const _origin = new Vec3();
const _previousPosition = new Vec3();
const _movement = new Vec3();
const _direction = new Vec3(0, 0, -1);

function moveTowards(current: number, target: number, maxDelta: number): number {
    if (Math.abs(target - current) <= maxDelta) return target;
    return current + Math.sign(target - current) * maxDelta;
}

/**
 * Lightweight visual wake driver for WaterSurface.
 *
 * The component owns one of the five bounded wake slots. By default it derives
 * wake direction/intensity from world-space movement, with node forward used as
 * a stable fallback when movement is nearly zero.
 */
@ccclass('cc.WaterWakeSource')
@menu('Mesh/WaterWakeSource')
export class WaterWakeSource extends Component {
    @property({ type: WaterSurface })
    public water: WaterSurface | null = null;

    @property({ type: CCInteger })
    @range([0, 4, 1])
    public slot = 0;

    @property
    public localOffset = new Vec3();

    @property
    public useMovementDirection = true;

    @property({ type: CCFloat })
    @range([0, 1, 0.01])
    public intensity = 1;

    @property({ type: CCFloat })
    @range([0, 50, 0.01])
    public minSpeed = 0.1;

    @property({ type: CCFloat })
    @range([0.01, 100, 0.01])
    public fullIntensitySpeed = 3;

    @property({ type: CCFloat })
    @range([0.01, 20, 0.01])
    public responseSpeed = 4;

    private _initialized = false;
    private _currentIntensity = 0;

    protected onEnable(): void {
        Vec3.copy(_previousPosition, this.node.worldPosition);
        this._initialized = true;
        this._currentIntensity = 0;
    }

    protected onDisable(): void {
        if (this.water) this.water.clearWakeSource(this.slot);
        this._initialized = false;
        this._currentIntensity = 0;
    }

    protected update(dt: number): void {
        if (!this.water) return;

        const frameDt = Math.max(1e-5, Math.min(dt, 0.1));
        const position = this.node.worldPosition;

        if (!this._initialized) {
            Vec3.copy(_previousPosition, position);
            this._initialized = true;
        }

        Vec3.subtract(_movement, position, _previousPosition);
        Vec3.copy(_previousPosition, position);

        const moveX = _movement.x;
        const moveZ = _movement.z;
        const horizontalDistance = Math.sqrt(moveX * moveX + moveZ * moveZ);
        const speed = horizontalDistance / frameDt;

        if (this.useMovementDirection && horizontalDistance > 1e-5) {
            const invDistance = 1 / horizontalDistance;
            _direction.set(moveX * invDistance, 0, moveZ * invDistance);
        } else {
            Vec3.transformQuat(_direction, Vec3.FORWARD, this.node.worldRotation);
            _direction.y = 0;
            const length = Math.sqrt(_direction.x * _direction.x + _direction.z * _direction.z);
            if (length > 1e-6) {
                _direction.x /= length;
                _direction.z /= length;
            } else {
                _direction.set(0, 0, -1);
            }
        }

        const speedRange = Math.max(1e-5, this.fullIntensitySpeed - this.minSpeed);
        let normalizedSpeed = Math.max(0, Math.min(1, (speed - this.minSpeed) / speedRange));
        // Smoothstep keeps low-speed wake subtle while still reaching full output.
        normalizedSpeed = normalizedSpeed * normalizedSpeed * (3 - 2 * normalizedSpeed);
        const targetIntensity = normalizedSpeed * Math.max(0, Math.min(1, this.intensity));
        this._currentIntensity = moveTowards(
            this._currentIntensity,
            targetIntensity,
            Math.max(0.01, this.responseSpeed) * frameDt,
        );

        Vec3.transformMat4(_origin, this.localOffset, this.node.worldMatrix);
        this.water.setWakeSource(this.slot, _origin, _direction, this._currentIntensity);
    }
}

cclegacy.WaterWakeSource = WaterWakeSource;
