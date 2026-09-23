/*
 Copyright (c) 2017-2023 Xiamen Yaji Software Co., Ltd.

 https://www.cocos.com/
*/

import { Vec3 } from '../../core';
import { Attribute, AttributeName, Format, FormatInfos, PrimitiveMode } from '../../gfx';
import { Mesh } from '../assets/mesh';

export const MAX_CAGE_CONTROLS = 8;
export const MAX_CAGE_INFLUENCES = 4;
export const CAGE_INDEX_ATTRIBUTE_0 = AttributeName.ATTR_TEX_COORD2;
export const CAGE_INDEX_ATTRIBUTE_1 = AttributeName.ATTR_TEX_COORD3;
export const CAGE_WEIGHT_ATTRIBUTE_0 = AttributeName.ATTR_TEX_COORD4;
export const CAGE_WEIGHT_ATTRIBUTE_1 = AttributeName.ATTR_TEX_COORD5;

export interface ICageSpringSettings {
    stiffness: number;
    damping: number;
    maxDisplacement: number;
}

export interface ICageLayout {
    positions: Vec3[];
    parents: number[];
    trunkCount: number;
}

export function hasCageInfluenceData (mesh: Mesh): boolean {
    mesh.initialize();
    let mask = 0;
    for (const bundle of mesh.struct.vertexBundles) {
        for (const attribute of bundle.attributes) {
            if (attribute.name === CAGE_INDEX_ATTRIBUTE_0) mask |= 1;
            if (attribute.name === CAGE_INDEX_ATTRIBUTE_1) mask |= 2;
            if (attribute.name === CAGE_WEIGHT_ATTRIBUTE_0) mask |= 4;
            if (attribute.name === CAGE_WEIGHT_ATTRIBUTE_1) mask |= 8;
        }
    }
    return mask === 15;
}

function clampControlCount (controlCount: number): number {
    return Math.max(2, Math.min(MAX_CAGE_CONTROLS, Math.floor(controlCount)));
}

function meshBounds (source: Mesh): { min: Vec3; max: Vec3 } {
    if (source.struct.minPosition && source.struct.maxPosition) {
        return {
            min: new Vec3(source.struct.minPosition.x, source.struct.minPosition.y, source.struct.minPosition.z),
            max: new Vec3(source.struct.maxPosition.x, source.struct.maxPosition.y, source.struct.maxPosition.z),
        };
    }

    const min = new Vec3(Infinity, Infinity, Infinity);
    const max = new Vec3(-Infinity, -Infinity, -Infinity);
    for (let primitiveIndex = 0; primitiveIndex < source.struct.primitives.length; ++primitiveIndex) {
        const positions = source.readAttribute(primitiveIndex, AttributeName.ATTR_POSITION);
        if (!(positions instanceof Float32Array)) continue;
        for (let i = 0; i + 2 < positions.length; i += 3) {
            min.x = Math.min(min.x, positions[i]);
            min.y = Math.min(min.y, positions[i + 1]);
            min.z = Math.min(min.z, positions[i + 2]);
            max.x = Math.max(max.x, positions[i]);
            max.y = Math.max(max.y, positions[i + 1]);
            max.z = Math.max(max.z, positions[i + 2]);
        }
    }
    if (!Number.isFinite(min.x)) min.set(-0.5, 0, -0.5);
    if (!Number.isFinite(max.x)) max.set(0.5, 1, 0.5);
    if (Math.abs(max.y - min.y) < 1e-6) max.y = min.y + 1;
    return { min, max };
}

/**
 * Deterministic v0.1 authoring layout.
 *
 * 2-5 controls: vertical trunk chain.
 * 6-8 controls: trunk chain plus crown-side controls parented to trunk top.
 */
export function buildDefaultCageLayout (source: Mesh, controlCount: number): ICageLayout {
    source.initialize();
    const count = clampControlCount(controlCount);
    const { min, max } = meshBounds(source);
    const centerX = (min.x + max.x) * 0.5;
    const centerZ = (min.z + max.z) * 0.5;
    const width = Math.max(0.001, max.x - min.x);
    const depth = Math.max(0.001, max.z - min.z);
    const height = max.y - min.y;

    const branchCount = count >= 6 ? Math.min(3, count - 4) : 0;
    const trunkCount = count - branchCount;
    const positions: Vec3[] = new Array(count);
    const parents: number[] = new Array(count);

    const trunkTopT = branchCount > 0 ? 0.82 : 1.0;
    for (let i = 0; i < trunkCount; ++i) {
        const t = trunkCount > 1 ? i / (trunkCount - 1) : 0;
        positions[i] = new Vec3(centerX, min.y + height * t * trunkTopT, centerZ);
        parents[i] = i === 0 ? -1 : i - 1;
    }

    const trunkTop = trunkCount - 1;
    for (let branchIndex = 0; branchIndex < branchCount; ++branchIndex) {
        const index = trunkCount + branchIndex;
        if (branchIndex === 0) {
            positions[index] = new Vec3(centerX - width * 0.42, min.y + height * 0.94, centerZ);
        } else if (branchIndex === 1) {
            positions[index] = new Vec3(centerX + width * 0.42, min.y + height * 0.94, centerZ);
        } else {
            positions[index] = new Vec3(centerX, min.y + height * 0.96, centerZ + depth * 0.42);
        }
        parents[index] = trunkTop;
    }

    return { positions, parents, trunkCount };
}

/**
 * Selects up to four spatially relevant controls for a vertex and encodes
 * indices/weights into two normalized RGBA8 attributes.
 */
export function encodeCageInfluences (
    position: Readonly<Vec3>,
    layout: Readonly<ICageLayout>,
    boundsMin: Readonly<Vec3>,
    boundsMax: Readonly<Vec3>,
    outIndices: Uint8Array,
    outWeights: Uint8Array,
    offset: number,
): void {
    const width = Math.max(0.001, boundsMax.x - boundsMin.x);
    const height = Math.max(0.001, boundsMax.y - boundsMin.y);
    const depth = Math.max(0.001, boundsMax.z - boundsMin.z);
    const normalizedHeight = Math.max(0, Math.min(1, (position.y - boundsMin.y) / height));

    // Hard plant the lowest vertices to the root. This is intentionally a
    // geometric rule rather than a spring constraint so the trunk cannot slide.
    if (normalizedHeight <= 0.035) {
        outIndices.fill(0, offset, offset + 4);
        outWeights[offset] = 255;
        outWeights[offset + 1] = 0;
        outWeights[offset + 2] = 0;
        outWeights[offset + 3] = 0;
        return;
    }

    const trunkCount = Math.max(2, Math.min(layout.trunkCount, layout.positions.length));
    const trunkTopY = layout.positions[trunkCount - 1].y;
    const trunkSpan = Math.max(1e-6, trunkTopY - layout.positions[0].y);
    const trunkT = Math.max(0, Math.min(1, (position.y - layout.positions[0].y) / trunkSpan)) * (trunkCount - 1);
    const trunk0 = Math.min(trunkCount - 1, Math.floor(trunkT));
    const trunk1 = Math.min(trunkCount - 1, trunk0 + 1);
    const trunkW1 = trunkT - trunk0;
    const trunkW0 = 1 - trunkW1;

    // Crown controls are deliberately prevented from influencing the central
    // trunk. Their contribution grows only for high AND laterally distant
    // vertices, which keeps the stem behaving like a bending beam instead of jelly.
    const centerX = (boundsMin.x + boundsMax.x) * 0.5;
    const centerZ = (boundsMin.z + boundsMax.z) * 0.5;
    const radialX = (position.x - centerX) / (width * 0.5);
    const radialZ = (position.z - centerZ) / (depth * 0.5);
    const radial = Math.min(1, Math.sqrt(radialX * radialX + radialZ * radialZ));
    const crownHeight = Math.max(0, Math.min(1, (normalizedHeight - 0.60) / 0.28));
    const branchMix = Math.min(0.72, crownHeight * radial * 0.72);

    const indices = [trunk0, trunk1, 0, 0];
    const weights = [trunkW0 * (1 - branchMix), trunkW1 * (1 - branchMix), 0, 0];

    if (layout.positions.length > trunkCount && branchMix > 0.0001) {
        let best0 = -1;
        let best1 = -1;
        let score0 = -1;
        let score1 = -1;

        for (let controlIndex = trunkCount; controlIndex < layout.positions.length; ++controlIndex) {
            const control = layout.positions[controlIndex];
            const dx = (position.x - control.x) / (width * 0.5);
            const dy = (position.y - control.y) / (height * 0.22);
            const dz = (position.z - control.z) / (depth * 0.5);
            const score = 1 / (0.05 + dx * dx + dy * dy + dz * dz);
            if (score > score0) {
                best1 = best0;
                score1 = score0;
                best0 = controlIndex;
                score0 = score;
            } else if (score > score1) {
                best1 = controlIndex;
                score1 = score;
            }
        }

        if (best0 >= 0) {
            const sum = Math.max(1e-6, score0 + Math.max(0, score1));
            indices[2] = best0;
            weights[2] = branchMix * score0 / sum;
            if (best1 >= 0) {
                indices[3] = best1;
                weights[3] = branchMix * score1 / sum;
            } else {
                weights[2] = branchMix;
            }
        }
    }

    let encodedWeightTotal = 0;
    for (let slot = 0; slot < MAX_CAGE_INFLUENCES; ++slot) {
        outIndices[offset + slot] = Math.round(indices[slot] / (MAX_CAGE_CONTROLS - 1) * 255);
        const encodedWeight = Math.round(Math.max(0, weights[slot]) * 255);
        outWeights[offset + slot] = encodedWeight;
        encodedWeightTotal += encodedWeight;
    }

    if (encodedWeightTotal !== 255) {
        outWeights[offset] = Math.max(0, Math.min(255, outWeights[offset] + (255 - encodedWeightTotal)));
    }
}

/**
 * Stable-enough semi-implicit damped spring used for bend-angle controls.
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

/**
 * Creates a static mesh clone with four cage influences per vertex.
 * Two RGBA8 attributes cost 8 bytes/vertex total.
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

    const layout = buildDefaultCageLayout(source, controlCount);
    const { min, max } = meshBounds(source);
    const originalStruct = source.struct;
    const primitives = originalStruct.primitives.map((primitive) => ({
        ...primitive,
        vertexBundelIndices: primitive.vertexBundelIndices.slice(),
        indexView: primitive.indexView ? { ...primitive.indexView } : undefined,
        cluster: undefined,
    }));

    const indexByBundle = new Map<number, Uint8Array>();
    const weightByBundle = new Map<number, Uint8Array>();

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
        if (bundle.attributes.some((attribute) =>
            attribute.name === CAGE_INDEX_ATTRIBUTE_0
            || attribute.name === CAGE_INDEX_ATTRIBUTE_1
            || attribute.name === CAGE_WEIGHT_ATTRIBUTE_0
            || attribute.name === CAGE_WEIGHT_ATTRIBUTE_1
        )) {
            throw new Error('Cage Deform source mesh already uses TEXCOORD_2..5 reserved for cage influences.');
        }

        const positions = source.readAttribute(primitiveIndex, AttributeName.ATTR_POSITION);
        if (!(positions instanceof Float32Array)) {
            throw new Error(`Cage Deform requires Float32 positions on primitive ${primitiveIndex}.`);
        }

        const indices = new Uint8Array(bundle.view.count * 4);
        const weights = new Uint8Array(bundle.view.count * 4);
        const vertexPosition = new Vec3();
        const vertexCount = Math.min(bundle.view.count, Math.floor(positions.length / 3));
        for (let vertexIndex = 0; vertexIndex < vertexCount; ++vertexIndex) {
            vertexPosition.set(
                positions[vertexIndex * 3],
                positions[vertexIndex * 3 + 1],
                positions[vertexIndex * 3 + 2],
            );
            encodeCageInfluences(vertexPosition, layout, min, max, indices, weights, vertexIndex * 4);
        }

        const existingIndices = indexByBundle.get(bundleIndex);
        const existingWeights = weightByBundle.get(bundleIndex);
        if (existingIndices && existingWeights) {
            if (existingIndices.length !== indices.length || existingWeights.length !== weights.length) {
                throw new Error('Shared cage vertex bundle mismatch.');
            }
            for (let i = 0; i < indices.length; ++i) {
                if (existingIndices[i] !== indices[i] || existingWeights[i] !== weights[i]) {
                    throw new Error('Shared cage vertex bundle produced incompatible influences.');
                }
            }
        } else {
            indexByBundle.set(bundleIndex, indices);
            weightByBundle.set(bundleIndex, weights);
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

        const indices = indexByBundle.get(bundleIndex);
        const weights = weightByBundle.get(bundleIndex);
        let chunk: Uint8Array;
        let stride = sourceBundle.view.stride;

        if (indices && weights) {
            let packedStride = 0;
            for (const attribute of sourceBundle.attributes) packedStride += FormatInfos[attribute.format].size;
            if (packedStride !== sourceBundle.view.stride) {
                throw new Error(`Cage Deform requires tightly packed primary vertex buffers (bundle ${bundleIndex}).`);
            }

            const sourceStride = sourceBundle.view.stride;
            stride = sourceStride + 8;
            chunk = new Uint8Array(sourceBundle.view.count * stride);
            for (let vertexIndex = 0; vertexIndex < sourceBundle.view.count; ++vertexIndex) {
                const srcOffset = vertexIndex * sourceStride;
                const dstOffset = vertexIndex * stride;
                chunk.set(sourceBytes.subarray(srcOffset, srcOffset + sourceStride), dstOffset);
                chunk.set(indices.subarray(vertexIndex * 4, vertexIndex * 4 + 4), dstOffset + sourceStride);
                chunk.set(weights.subarray(vertexIndex * 4, vertexIndex * 4 + 4), dstOffset + sourceStride + 4);
            }
            attributes.push(new Attribute(CAGE_INDEX_ATTRIBUTE_0, Format.RG8, true));
            attributes.push(new Attribute(CAGE_INDEX_ATTRIBUTE_1, Format.RG8, true));
            attributes.push(new Attribute(CAGE_WEIGHT_ATTRIBUTE_0, Format.RG8, true));
            attributes.push(new Attribute(CAGE_WEIGHT_ATTRIBUTE_1, Format.RG8, true));
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
