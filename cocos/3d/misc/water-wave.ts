/*
 Copyright (c) 2026 KropAl-Playable
*/

import { Vec2, Vec3 } from '../../core';

export const MAX_WATER_WAVES = 4;
const TWO_PI = Math.PI * 2;
const EPSILON = 1e-6;

export interface IWaterWave {
    direction: Readonly<Vec2>;
    amplitude: number;
    wavelength: number;
    speed: number;
    steepness: number;
    phase: number;
}

export interface IWaterSample {
    /** Local-space height/displacement Y. */
    height: number;
    /** Local-space displaced position. */
    position: Vec3;
    /** Local-space analytical normal. */
    normal: Vec3;
    /** Local-space surface velocity. */
    velocity: Vec3;
}

export function createWaterSample(): IWaterSample {
    return {
        height: 0,
        position: new Vec3(),
        normal: new Vec3(0, 1, 0),
        velocity: new Vec3(),
    };
}

/**
 * Evaluates the same bounded Gerstner convention used by playable-water.effect.
 *
 * theta = k * (dot(D, xz) - speed * time) + phase
 * horizontal = Q * A * D * cos(theta)
 * vertical = A * sin(theta)
 *
 * Direction is normalized before evaluation. Wavelength is clamped away from
 * zero. Steepness is expected in [0, 1], but is clamped defensively.
 */
export function sampleGerstnerWaves(
    x: number,
    z: number,
    time: number,
    waves: readonly IWaterWave[],
    out: IWaterSample = createWaterSample(),
    activeCount = waves.length,
): IWaterSample {
    let px = x;
    let py = 0;
    let pz = z;

    // Derivatives of displaced P(x,z). Start with the undeformed plane basis.
    let dPdxX = 1;
    let dPdxY = 0;
    let dPdxZ = 0;
    let dPdzX = 0;
    let dPdzY = 0;
    let dPdzZ = 1;

    let velocityX = 0;
    let velocityY = 0;
    let velocityZ = 0;

    const count = Math.max(0, Math.min(MAX_WATER_WAVES, waves.length, Math.floor(activeCount)));
    for (let i = 0; i < count; ++i) {
        const wave = waves[i];
        const dx0 = wave.direction.x;
        const dz0 = wave.direction.y;
        const dirLength = Math.sqrt(dx0 * dx0 + dz0 * dz0);
        if (dirLength <= EPSILON || Math.abs(wave.amplitude) <= EPSILON) continue;

        const invDirLength = 1 / dirLength;
        const dx = dx0 * invDirLength;
        const dz = dz0 * invDirLength;
        const wavelength = Math.max(Math.abs(wave.wavelength), EPSILON);
        const k = TWO_PI / wavelength;
        const amplitude = wave.amplitude;
        const q = Math.max(0, Math.min(1, wave.steepness));
        const theta = k * (dx * x + dz * z - wave.speed * time) + wave.phase;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const qa = q * amplitude;
        const ak = amplitude * k;
        const qakSin = q * ak * sinTheta;

        px += qa * dx * cosTheta;
        py += amplitude * sinTheta;
        pz += qa * dz * cosTheta;

        dPdxX -= qakSin * dx * dx;
        dPdxY += ak * dx * cosTheta;
        dPdxZ -= qakSin * dx * dz;

        dPdzX -= qakSin * dx * dz;
        dPdzY += ak * dz * cosTheta;
        dPdzZ -= qakSin * dz * dz;

        const angularSpeed = k * wave.speed;
        velocityX += qa * dx * angularSpeed * sinTheta;
        velocityY -= amplitude * angularSpeed * cosTheta;
        velocityZ += qa * dz * angularSpeed * sinTheta;
    }

    // cross(dP/dz, dP/dx) points upward for the undeformed XZ plane.
    const nx = dPdzY * dPdxZ - dPdzZ * dPdxY;
    const ny = dPdzZ * dPdxX - dPdzX * dPdxZ;
    const nz = dPdzX * dPdxY - dPdzY * dPdxX;
    const normalLength = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;

    out.height = py;
    out.position.set(px, py, pz);
    out.normal.set(nx / normalLength, ny / normalLength, nz / normalLength);
    out.velocity.set(velocityX, velocityY, velocityZ);
    return out;
}
