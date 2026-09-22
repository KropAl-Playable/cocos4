import { Vec3 } from '../../cocos/core';
import { encodeCageInfluences, ICageLayout, MAX_CAGE_CONTROLS, stepCageSpring } from '../../cocos/3d/misc/cage-deform';

describe('Cage Deform', () => {
    const layout: ICageLayout = {
        positions: [
            new Vec3(0, 0, 0),
            new Vec3(0, 1, 0),
            new Vec3(0, 2, 0),
            new Vec3(0, 3, 0),
            new Vec3(-1, 4, 0),
            new Vec3(1, 4, 0),
            new Vec3(0, 4, 1),
        ],
        parents: [-1, 0, 1, 2, 3, 3, 3],
    };

    test('encodes four normalized spatial influences into two RGBA8 attributes', () => {
        const indices = new Uint8Array(4);
        const weights = new Uint8Array(4);
        encodeCageInfluences(
            new Vec3(0.8, 3.8, 0),
            layout,
            new Vec3(-1, 0, -1),
            new Vec3(1, 4, 1),
            indices,
            weights,
            0,
        );

        const decoded = Array.from(indices, (value) => Math.round(value / 255 * (MAX_CAGE_CONTROLS - 1)));
        const weightSum = weights[0] + weights[1] + weights[2] + weights[3];

        expect(decoded).toContain(5);
        expect(weightSum).toBe(255);
        expect(weights[0]).toBeGreaterThan(0);
    });

    test('hard-plants vertices at the mesh base to root control', () => {
        const indices = new Uint8Array(4);
        const weights = new Uint8Array(4);
        encodeCageInfluences(
            new Vec3(0, 0, 0),
            layout,
            new Vec3(-1, 0, -1),
            new Vec3(1, 4, 1),
            indices,
            weights,
            0,
        );

        expect(indices[0]).toBe(0);
        expect(weights[0]).toBe(255);
        expect(weights[1]).toBe(0);
        expect(weights[2]).toBe(0);
        expect(weights[3]).toBe(0);
    });

    test('damped spring returns bend angle toward its target without exceeding clamp', () => {
        const offset = new Vec3(1, 0, 0);
        const velocity = new Vec3();
        const target = new Vec3();

        for (let i = 0; i < 120; ++i) {
            stepCageSpring(offset, velocity, target, {
                stiffness: 18,
                damping: 0.9,
                maxDisplacement: 0.65,
            }, 1 / 60);
        }

        expect(Math.abs(offset.x)).toBeLessThan(0.05);
        expect(Vec3.len(offset)).toBeLessThanOrEqual(0.65);
    });
});
