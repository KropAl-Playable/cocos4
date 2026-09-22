import { Vec3 } from '../../cocos/core';
import { encodeCageInfluence, MAX_CAGE_CONTROLS, stepCageSpring } from '../../cocos/3d/misc/cage-deform';

describe('Cage Deform', () => {
    test('encodes adjacent two-control influences into RGBA8', () => {
        const encoded = new Uint8Array(4);
        encodeCageInfluence(0.5, 6, encoded, 0);

        const i0 = Math.round(encoded[0] / 255 * (MAX_CAGE_CONTROLS - 1));
        const i1 = Math.round(encoded[1] / 255 * (MAX_CAGE_CONTROLS - 1));
        const w0 = encoded[2] / 255;
        const w1 = encoded[3] / 255;

        expect(i0).toBe(2);
        expect(i1).toBe(3);
        expect(w0 + w1).toBeCloseTo(1, 2);
        expect(w0).toBeCloseTo(0.5, 1);
        expect(w1).toBeCloseTo(0.5, 1);
    });

    test('keeps the root endpoint fully attached to control zero', () => {
        const encoded = new Uint8Array(4);
        encodeCageInfluence(0, 6, encoded, 0);

        expect(Math.round(encoded[0] / 255 * (MAX_CAGE_CONTROLS - 1))).toBe(0);
        expect(encoded[2]).toBe(255);
        expect(encoded[3]).toBe(0);
    });

    test('damped spring returns toward its target without exceeding displacement clamp', () => {
        const offset = new Vec3(1, 0, 0);
        const velocity = new Vec3();
        const target = new Vec3();

        for (let i = 0; i < 120; ++i) {
            stepCageSpring(offset, velocity, target, {
                stiffness: 18,
                damping: 0.9,
                maxDisplacement: 1.5,
            }, 1 / 60);
        }

        expect(Math.abs(offset.x)).toBeLessThan(0.05);
        expect(Vec3.len(offset)).toBeLessThanOrEqual(1.5);
    });
});
