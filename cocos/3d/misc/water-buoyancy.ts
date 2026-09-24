/*
 Copyright (c) 2026 KropAl-Playable
*/

export interface IWaterBuoyancySettings {
    buoyancy: number;
    damping: number;
    maxForce: number;
    maxSubmersion: number;
}

/**
 * Computes the vertical force for one buoyancy sample.
 *
 * Positive depth means the sample is submerged. Damping uses velocity relative
 * to the moving analytical water surface, so a rising crest can carry the body.
 */
export function computeBuoyancyForceY(
    depth: number,
    relativeVerticalVelocity: number,
    settings: Readonly<IWaterBuoyancySettings>,
): number {
    if (depth <= 0) return 0;

    const submergedDepth = Math.min(Math.max(depth, 0), Math.max(settings.maxSubmersion, 1e-6));
    const springForce = submergedDepth * Math.max(0, settings.buoyancy);
    const dampingForce = -relativeVerticalVelocity * Math.max(0, settings.damping);
    const maxForce = Math.max(0, settings.maxForce);

    return Math.max(0, Math.min(maxForce, springForce + dampingForce));
}
