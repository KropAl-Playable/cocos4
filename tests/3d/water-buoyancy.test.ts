import { computeBuoyancyForceY } from '../../cocos/3d/misc/water-buoyancy';

describe('Water buoyancy', () => {
    const settings = {
        buoyancy: 12.5,
        damping: 4,
        maxForce: 50,
        maxSubmersion: 1,
    };

    test('returns zero above the water surface', () => {
        expect(computeBuoyancyForceY(-0.1, 0, settings)).toBe(0);
        expect(computeBuoyancyForceY(0, 0, settings)).toBe(0);
    });

    test('increases restoring force with submerged depth', () => {
        const shallow = computeBuoyancyForceY(0.2, 0, settings);
        const deep = computeBuoyancyForceY(0.6, 0, settings);
        expect(deep).toBeGreaterThan(shallow);
    });

    test('damps downward motion relative to the moving water surface', () => {
        const falling = computeBuoyancyForceY(0.4, -1, settings);
        const rising = computeBuoyancyForceY(0.4, 1, settings);
        expect(falling).toBeGreaterThan(rising);
    });

    test('clamps depth and force to predictable bounds', () => {
        const force = computeBuoyancyForceY(100, -100, settings);
        expect(force).toBe(settings.maxForce);
    });
});
