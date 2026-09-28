/*
 Copyright (c) 2026 KropAl-Playable
 SPDX-License-Identifier: MIT
 */

export interface PhysicsBackendCapabilities {
    /**
     * Native or exact custom center-of-mass support.
     */
    centerOfMass: boolean;
    /**
     * Per-body gravity multiplier beyond the binary useGravity switch.
     */
    gravityScale: boolean;
    /**
     * Independent linear/angular axis locks.
     */
    axisLocks: boolean;
    /**
     * Continuous collision detection.
     */
    ccd: boolean;
    /**
     * Collider/material restitution support.
     */
    restitution: boolean;
    /**
     * Independent friction/restitution combine modes.
     */
    materialCombineModes: boolean;
}

export const DEFAULT_PHYSICS_BACKEND_CAPABILITIES: Readonly<PhysicsBackendCapabilities> = {
    centerOfMass: false,
    gravityScale: false,
    axisLocks: false,
    ccd: false,
    restitution: true,
    materialCombineModes: false,
};
