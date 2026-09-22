import { Vec3 } from '../../cocos/core';
import { Mesh } from '../../cocos/3d/assets/mesh';
import { bakeMeshAmbientOcclusion } from '../../cocos/3d/misc/ao-baker';
import { Attribute, AttributeName, Format, PrimitiveMode } from '../../cocos/gfx';

function createPlaneMesh (z = 0, extent = 1): Mesh {
    const vertexCount = 4;
    const stride = 24;
    const vertexBytes = vertexCount * stride;
    const indexBytes = 6 * 2;
    const data = new Uint8Array(vertexBytes + indexBytes);
    const view = new DataView(data.buffer);

    const positions = [
        -extent, -extent, z,
        extent, -extent, z,
        extent, extent, z,
        -extent, extent, z,
    ];
    for (let i = 0; i < vertexCount; ++i) {
        const base = i * stride;
        view.setFloat32(base, positions[i * 3], true);
        view.setFloat32(base + 4, positions[i * 3 + 1], true);
        view.setFloat32(base + 8, positions[i * 3 + 2], true);
        view.setFloat32(base + 12, 0, true);
        view.setFloat32(base + 16, 0, true);
        view.setFloat32(base + 20, 1, true);
    }

    const indices = new Uint16Array(data.buffer, vertexBytes, 6);
    indices.set([0, 1, 2, 0, 2, 3]);

    const mesh = new Mesh('test-plane');
    mesh.reset({
        struct: {
            vertexBundles: [{
                view: { offset: 0, length: vertexBytes, count: vertexCount, stride },
                attributes: [
                    new Attribute(AttributeName.ATTR_POSITION, Format.RGB32F),
                    new Attribute(AttributeName.ATTR_NORMAL, Format.RGB32F),
                ],
            }],
            primitives: [{
                vertexBundelIndices: [0],
                primitiveMode: PrimitiveMode.TRIANGLE_LIST,
                indexView: { offset: vertexBytes, length: indexBytes, count: 6, stride: 2 },
            }],
            minPosition: new Vec3(-extent, -extent, z),
            maxPosition: new Vec3(extent, extent, z),
        },
        data,
    });
    return mesh;
}

describe('AO Baker', () => {
    test('keeps unoccluded vertices fully visible and writes RGBA8 color data', () => {
        const source = createPlaneMesh();
        const result = bakeMeshAmbientOcclusion(
            { mesh: source },
            [],
            { sampleCount: 16, selfOcclusion: false, sceneOccluders: false, channel: 'r' },
        );

        expect(Array.from(result.values[0])).toEqual([1, 1, 1, 1]);
        expect(result.stats.vertexCount).toBe(4);
        expect(result.stats.rayCount).toBe(64);

        const colors = result.mesh.readAttribute(0, AttributeName.ATTR_COLOR);
        expect(colors).toBeInstanceOf(Uint8Array);
        expect(Array.from(colors!)).toEqual([
            255, 255, 255, 255,
            255, 255, 255, 255,
            255, 255, 255, 255,
            255, 255, 255, 255,
        ]);
    });

    test('scene occluder darkens a selected vertex color channel', () => {
        const source = createPlaneMesh(0, 0.5);
        const ceiling = createPlaneMesh(0.1, 100);
        const result = bakeMeshAmbientOcclusion(
            { mesh: source },
            [{ mesh: ceiling }],
            {
                sampleCount: 32,
                maxDistance: 1,
                rayBias: 0.001,
                selfOcclusion: false,
                sceneOccluders: true,
                channel: 'g',
            },
        );

        expect(result.stats.averageAO).toBeLessThan(0.25);
        const colors = result.mesh.readAttribute(0, AttributeName.ATTR_COLOR) as Uint8Array;
        for (let i = 0; i < 4; ++i) {
            expect(colors[i * 4]).toBe(255);
            expect(colors[i * 4 + 1]).toBeLessThan(64);
            expect(colors[i * 4 + 2]).toBe(255);
            expect(colors[i * 4 + 3]).toBe(255);
        }
    });
});
