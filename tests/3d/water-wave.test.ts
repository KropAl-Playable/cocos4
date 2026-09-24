import { Vec2 } from '../../cocos/core';
import { createWaterSample, sampleGerstnerWaves } from '../../cocos/3d/misc/water-wave';

describe('Water waves', () => {
    test('flat surface remains unchanged with zero active waves', () => {
        const sample = createWaterSample();
        sampleGerstnerWaves(2, -3, 1.25, [], sample, 0);

        expect(sample.position.x).toBeCloseTo(2, 6);
        expect(sample.position.y).toBeCloseTo(0, 6);
        expect(sample.position.z).toBeCloseTo(-3, 6);
        expect(sample.normal.x).toBeCloseTo(0, 6);
        expect(sample.normal.y).toBeCloseTo(1, 6);
        expect(sample.normal.z).toBeCloseTo(0, 6);
    });

    test('single Gerstner wave matches the documented phase convention', () => {
        const sample = createWaterSample();
        const wave = {
            direction: new Vec2(1, 0),
            amplitude: 0.5,
            wavelength: Math.PI * 2,
            speed: 1,
            steepness: 0.4,
            phase: 0,
        };

        sampleGerstnerWaves(Math.PI / 2, 0, 0, [wave], sample);

        expect(sample.height).toBeCloseTo(0.5, 6);
        expect(sample.position.y).toBeCloseTo(0.5, 6);
        expect(sample.position.x).toBeCloseTo(Math.PI / 2, 6);
        expect(sample.normal.y).toBeGreaterThan(0.99);
    });

    test('activeCount excludes visual/gameplay layers without allocating filtered arrays', () => {
        const sample = createWaterSample();
        const waves = [
            {
                direction: new Vec2(1, 0),
                amplitude: 0.25,
                wavelength: 4,
                speed: 0,
                steepness: 0,
                phase: Math.PI / 2,
            },
            {
                direction: new Vec2(0, 1),
                amplitude: 10,
                wavelength: 2,
                speed: 0,
                steepness: 0,
                phase: Math.PI / 2,
            },
        ];

        sampleGerstnerWaves(0, 0, 0, waves, sample, 1);
        expect(sample.height).toBeCloseTo(0.25, 6);
    });

    test('surface velocity follows the same phase and travel-speed convention', () => {
        const sample = createWaterSample();
        const wave = {
            direction: new Vec2(1, 0),
            amplitude: 0.5,
            wavelength: Math.PI * 2,
            speed: 2,
            steepness: 0,
            phase: 0,
        };

        sampleGerstnerWaves(0, 0, 0, [wave], sample);
        expect(sample.velocity.y).toBeCloseTo(-1, 6);
    });
});
