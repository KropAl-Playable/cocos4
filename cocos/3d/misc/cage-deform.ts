/*
 Copyright (c) 2017-2023 Xiamen Yaji Software Co., Ltd.

 https://www.cocos.com/
*/

import { Vec3 } from '../../core';
import { Attribute, AttributeName, Format, FormatInfos, PrimitiveMode } from '../../gfx';
import { Mesh } from '../assets/mesh';

export const MAX_CAGE_CONTROLS = 8;
export const CAGE_INFLUENCE_ATTRIBUTE = 'a_cageInfluence';

export interface ICageSpringSettings {
    stiffness: number;
    damping: number;
    maxDisplacement: number;
}

/**
 * Encodes two adjacent cage-control indices and their weights into one RGBA8
 * normalized attribute:
 *   R = control index 0 / 7
 *   G = control index 1 / 7
 *   B = weight 0
 *   A = weight 1
 */
export function encodeCageInfluence (
    normalizedHeight: number,
    controlCount: number,
    output: Uint8Array,
    offset: number,
): void {
    const count = Math.max(2, Math.min(MAX_CAGE_CONTROLS, Math.floor(controlCount)));
    const t = Math.max(0, Math.min(1, normalizedHeight)) * (count - 1);
    const i0 = Math.floor(t);
    const i1 = Math.min(count - 1, i0 + 1);
    const w1 = t - i0;
    const w0 = 1 - w1;
    output[offset] = Math.round(i0 / (MAX_CAGE_CONTROLS - 1) * 255);
    output[offset + 1] = Math.round(i1 / (MAX_CAGE_CONTROLS - 1) * 255);
    output[offset + 2] = Math.round(w0 * 255);
    output[offset + 3] = Math.round(w1 * 255);
}

/**
 * Stable-enough semi-implicit damped spring used by CageDeformer controls.
 * Mutates offset/velocity and allocates nothing.
 */
export function stepCageSpring (
    offset: Vec3,
    velocity: Vec3,
    target: Readonly<Vec3>,
    settings: Readonly<ICageSpringSettings>,
    dt: number,
): void {
    const clampedDt = Math.max(0, Math.min(dt, 1 / 20));
    const stiffness = Math.max(0, settings.stiffness);
    const damping = Math.max(0, Math.min(1, settings.damping));

    velocity.x += (target.x - offset.x) * stiffness * clampedDt;
    velocity.y += (target.y - offset.y) * stiffness * clampedDt;
    velocity.z += (target.z - offset.z) * stiffness * clampedDt;

    const dampingFactor = Math.pow(damping, clampedDt * 60);
    velocity.x *= dampingFactor;
    velocity.y *= dampingFactor;
    velocity.z *= dampingFactor;

    offset.x += velocity.x * clampedDt;
    offset.y += velocity.y * clampedDt;
    offset.z += velocity.z * clampedDt;

    const maxDisplacement = Math.max(0, settings.maxDisplacement);
    const lengthSqr = offset.x * offset.x + offset.y * offset.y + offset.z * offset.z;
    if (maxDisplacement > 0 && lengthSqr > maxDisplacement * maxDisplacement) {
        const scale = maxDisplacement / Math.sqrt(lengthSqr);
        offset.x *= scale;
        offset.y *= scale;
        offset.z *= scale;
    }
}

function meshHeightBounds (source: Mesh): { minY: number; maxY: number } {
    if (source.struct.minPosition && source.struct.maxPosition) {
        return { minY: source.struct.minPosition.y, maxY: source.struct.maxPosition.y };
    }

    let minY = Infinity;
    let maxY = -Infinity;
    for (let primitiveIndex = 0; primitiveIndex < source.struct.primitives.length; ++primitiveIndex) {
        const positions = source.readAttribute(primitiveIndex, AttributeName.ATTR_POSITION);
        if (!(positions instanceof Float32Array)) continue;
        for (let i = 1; i < positions.length; i += 3) {
            minY = Math.min(minY, positions[i]);
            maxY = Math.max(maxY, positions[i]);
        }
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return { minY: 0, maxY: 1 };
    if (Math.abs(maxY - minY) < 1e-6) maxY = minY + 1;
    return { minY, maxY };
}

/**
 * Creates a static mesh clone with one compact RGBA8 cage-influence attribute.
 * This is a one-time setup operation; deformation itself remains GPU-only.
 */
export function createCageInfluenceMesh (source: Mesh, controlCount: number): Mesh {
    source.initialize();
    if (source.struct.dynamic) throw new Error('Cage Deform v0.1 supports static meshes only.');
    if (source.struct.morph) throw new Error('Cage Deform v0.1 does not support morph meshes.');
    if (source.struct.cluster || source.struct.primitives.some((primitive) => primitive.cluster)) {
        throw new Error('Cage Deform v0.1 does not support clustered meshes.');
    }
    if (source.struct.compressed || source.struct.quantized) {
        throw new Error('Cage Deform v0.1 requires a decompressed, non-quantized mesh.');
    }

    const { minY, maxY } = meshHeightBounds(source);
    const invHeight = 1 / Math.max(1e-6, maxY - minY);
    const originalStruct = source.struct;
    const primitives = originalStruct.primitives.map((primitive) => ({
        ...primitive,
        vertexBundelIndices: primitive.vertexBundelIndices.slice(),
        indexView: primitive.indexView ? { ...primitive.indexView } : undefined,
        cluster: undefined,
    }));

    const influenceByBundle = new Map<number, Uint8Array>();

    for (let primitiveIndex = 0; primitiveIndex < primitives.length; ++primitiveIndex) {
        const primitive = primitives[primitiveIndex];
        if (primitive.primitiveMode !== PrimitiveMode.TRIANGLE_LIST) {
            throw new Error(`Cage Deform v0.1 supports TRIANGLE_LIST only (primitive ${primitiveIndex}).`);
        }
        if (!primitive.vertexBundelIndices.length) {
            throw new Error(`Cage Deform found no vertex bundle on primitive ${primitiveIndex}.`);
        }

        const bundleIndex = primitive.vertexBundelIndices[0];
        const bundle = originalStruct.vertexBundles[bundleIndex];
        if (bundle.attributes.some((attribute) => attribute.name === CAGE_INFLUENCE_ATTRIBUTE)) continue;

        const positions = source.readAttribute(primitiveIndex, AttributeName.ATTR_POSITION);
        if (!(positions instanceof Float32Array)) {
            throw new Error(`Cage Deform requires Float32 positions on primitive ${primitiveIndex}.`);
        }

        const influences = new Uint8Array(bundle.view.count * 4);
        const vertexCount = Math.min(bundle.view.count, Math.floor(positions.length / 3));
        for (let vertexIndex = 0; vertexIndex < vertexCount; ++vertexIndex) {
            const y = positions[vertexIndex * 3 + 1];
            encodeCageInfluence((y - minY) * invHeight, controlCount, influences, vertexIndex * 4);
        }

        const existing = influenceByBundle.get(bundleIndex);
        if (existing) {
            if (existing.length !== influences.length) throw new Error('Shared cage vertex bundle mismatch.');
            for (let i = 0; i < existing.length; ++i) {
                if (existing[i] !== influences[i]) throw new Error('Shared cage vertex bundle produced incompatible influences.');
            }
        } else {
            influenceByBundle.set(bundleIndex, influences);
        }
    }

    const vertexBundles: Mesh.IVertexBundle[] = [];
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    for (let bundleIndex = 0; bundleIndex < originalStruct.vertexBundles.length; ++bundleIndex) {
        const sourceBundle = originalStruct.vertexBundles[bundleIndex];
        const sourceBytes = new Uint8Array(
            source.data.buffer,
            source.data.byteOffset + sourceBundle.view.offset,
            sourceBundle.view.length,
        );
        const attributes = sourceBundle.attributes.map((attribute) => new Attribute(
            attribute.name,
            attribute.format,
            attribute.isNormalized,
            attribute.stream,
            attribute.isInstanced,
            attribute.location,
        ));

        const influence = influenceByBundle.get(bundleIndex);
        let chunk: Uint8Array;
        let stride = sourceBundle.view.stride;

        if (influence) {
            let packedStride = 0;
            for (const attribute of sourceBundle.attributes) packedStride += FormatInfos[attribute.format].size;
            if (packedStride !== sourceBundle.view.stride) {
                throw new Error(`Cage Deform requires tightly packed primary vertex buffers (bundle ${bundleIndex}).`);
            }

            const sourceStride = sourceBundle.view.stride;
            stride = sourceStride + 4;
            chunk = new Uint8Array(sourceBundle.view.count * stride);
            for (let vertexIndex = 0; vertexIndex < sourceBundle.view.count; ++vertexIndex) {
                const srcOffset = vertexIndex * sourceStride;
                const dstOffset = vertexIndex * stride;
                chunk.set(sourceBytes.subarray(srcOffset, srcOffset + sourceStride), dstOffset);
                chunk.set(influence.subarray(vertexIndex * 4, vertexIndex * 4 + 4), dstOffset + sourceStride);
            }
            attributes.push(new Attribute(CAGE_INFLUENCE_ATTRIBUTE, Format.RGBA8, true));
        } else {
            chunk = new Uint8Array(sourceBytes);
        }

        vertexBundles.push({
            view: {
                offset: totalBytes,
                length: chunk.byteLength,
                count: sourceBundle.view.count,
                stride,
            },
            attributes,
        });
        chunks.push(chunk);
        totalBytes += chunk.byteLength;
    }

    const indexChunks: Uint8Array[] = [];
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; ++primitiveIndex) {
        const sourceIndexView = originalStruct.primitives[primitiveIndex].indexView;
        if (!sourceIndexView) continue;
        const chunk = new Uint8Array(
            source.data.buffer,
            source.data.byteOffset + sourceIndexView.offset,
            sourceIndexView.length,
        ).slice();
        primitives[primitiveIndex].indexView = {
            offset: totalBytes,
            length: sourceIndexView.length,
            count: sourceIndexView.count,
            stride: sourceIndexView.stride,
        };
        indexChunks.push(chunk);
        totalBytes += chunk.byteLength;
    }

    const data = new Uint8Array(totalBytes);
    let writeOffset = 0;
    for (const chunk of chunks) {
        data.set(chunk, writeOffset);
        writeOffset += chunk.byteLength;
    }
    for (const chunk of indexChunks) {
        data.set(chunk, writeOffset);
        writeOffset += chunk.byteLength;
    }

    const mesh = new Mesh(source.name ? `${source.name}-cage` : 'cage-deform-mesh');
    mesh.reset({
        struct: {
            vertexBundles,
            primitives,
            minPosition: originalStruct.minPosition
                ? new Vec3(originalStruct.minPosition.x, originalStruct.minPosition.y, originalStruct.minPosition.z)
                : undefined,
            maxPosition: originalStruct.maxPosition
                ? new Vec3(originalStruct.maxPosition.x, originalStruct.maxPosition.y, originalStruct.maxPosition.z)
                : undefined,
            jointMaps: originalStruct.jointMaps?.map((map) => map.slice()),
            quantized: false,
            encoded: false,
            compressed: false,
            cluster: false,
        },
        data,
    });
    return mesh;
}
