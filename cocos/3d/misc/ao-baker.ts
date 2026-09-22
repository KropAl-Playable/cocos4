/*
 Copyright (c) 2017-2026 Xiamen Yaji Software Co., Ltd.

 https://www.cocos.com/

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 of the Software, and to permit persons to whom the Software is furnished to do so,
 subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.
*/

import { Mat4, Vec3 } from '../../core';
import { Attribute, AttributeName, Format, PrimitiveMode } from '../../gfx';
import { Mesh } from '../assets/mesh';

export type AOVertexColorChannel = 'r' | 'g' | 'b' | 'a';

export interface IAOBakeTarget {
    mesh: Mesh;
    worldMatrix?: Readonly<Mat4>;
}

export interface IAOBakeOptions {
    sampleCount?: number;
    maxDistance?: number;
    rayBias?: number;
    strength?: number;
    contrast?: number;
    selfOcclusion?: boolean;
    sceneOccluders?: boolean;
    doubleSided?: boolean;
    channel?: AOVertexColorChannel;
}

export interface IAOBakeStats {
    vertexCount: number;
    rayCount: number;
    durationMs: number;
    minAO: number;
    averageAO: number;
    maxAO: number;
}

export interface IAOBakeResult {
    mesh: Mesh;
    values: Float32Array[];
    stats: IAOBakeStats;
}

interface IResolvedOptions {
    sampleCount: number;
    maxDistance: number;
    rayBias: number;
    strength: number;
    contrast: number;
    selfOcclusion: boolean;
    sceneOccluders: boolean;
    doubleSided: boolean;
    channel: AOVertexColorChannel;
}

interface ITriangle {
    ax: number; ay: number; az: number;
    bx: number; by: number; bz: number;
    cx: number; cy: number; cz: number;
    minX: number; minY: number; minZ: number;
    maxX: number; maxY: number; maxZ: number;
}

interface IOccluder {
    source: IAOBakeTarget;
    triangles: ITriangle[];
    minX: number; minY: number; minZ: number;
    maxX: number; maxY: number; maxZ: number;
}

const DEFAULT_OPTIONS: IResolvedOptions = {
    sampleCount: 32,
    maxDistance: 2,
    rayBias: 0.002,
    strength: 1,
    contrast: 1,
    selfOcclusion: true,
    sceneOccluders: true,
    doubleSided: true,
    channel: 'r',
};

const _position = new Vec3();
const _normal = new Vec3();

function resolveOptions (options?: IAOBakeOptions): IResolvedOptions {
    const sampleCount = Math.max(1, Math.floor(options?.sampleCount ?? DEFAULT_OPTIONS.sampleCount));
    return {
        sampleCount,
        maxDistance: Math.max(0, options?.maxDistance ?? DEFAULT_OPTIONS.maxDistance),
        rayBias: Math.max(0, options?.rayBias ?? DEFAULT_OPTIONS.rayBias),
        strength: Math.max(0, options?.strength ?? DEFAULT_OPTIONS.strength),
        contrast: Math.max(0.0001, options?.contrast ?? DEFAULT_OPTIONS.contrast),
        selfOcclusion: options?.selfOcclusion ?? DEFAULT_OPTIONS.selfOcclusion,
        sceneOccluders: options?.sceneOccluders ?? DEFAULT_OPTIONS.sceneOccluders,
        doubleSided: options?.doubleSided ?? DEFAULT_OPTIONS.doubleSided,
        channel: options?.channel ?? DEFAULT_OPTIONS.channel,
    };
}

function radicalInverseVdC (bits: number): number {
    bits = ((bits << 16) | (bits >>> 16)) >>> 0;
    bits = (((bits & 0x55555555) << 1) | ((bits & 0xAAAAAAAA) >>> 1)) >>> 0;
    bits = (((bits & 0x33333333) << 2) | ((bits & 0xCCCCCCCC) >>> 2)) >>> 0;
    bits = (((bits & 0x0F0F0F0F) << 4) | ((bits & 0xF0F0F0F0) >>> 4)) >>> 0;
    bits = (((bits & 0x00FF00FF) << 8) | ((bits & 0xFF00FF00) >>> 8)) >>> 0;
    return bits * 2.3283064365386963e-10;
}

function channelIndex (channel: AOVertexColorChannel): number {
    switch (channel) {
    case 'r': return 0;
    case 'g': return 1;
    case 'b': return 2;
    default: return 3;
    }
}

function transformPoint (out: Vec3, x: number, y: number, z: number, matrix?: Readonly<Mat4>): Vec3 {
    Vec3.set(out, x, y, z);
    if (matrix) Vec3.transformMat4(out, out, matrix);
    return out;
}

function transformNormal (out: Vec3, x: number, y: number, z: number, matrix?: Readonly<Mat4>): Vec3 {
    Vec3.set(out, x, y, z);
    if (matrix) Vec3.transformMat4Normal(out, out, matrix);
    Vec3.normalize(out, out);
    return out;
}

function makeTriangle (
    positions: Float32Array,
    i0: number,
    i1: number,
    i2: number,
    matrix?: Readonly<Mat4>,
): ITriangle {
    transformPoint(_position, positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2], matrix);
    const ax = _position.x; const ay = _position.y; const az = _position.z;
    transformPoint(_position, positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2], matrix);
    const bx = _position.x; const by = _position.y; const bz = _position.z;
    transformPoint(_position, positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2], matrix);
    const cx = _position.x; const cy = _position.y; const cz = _position.z;
    return {
        ax, ay, az, bx, by, bz, cx, cy, cz,
        minX: Math.min(ax, bx, cx), minY: Math.min(ay, by, cy), minZ: Math.min(az, bz, cz),
        maxX: Math.max(ax, bx, cx), maxY: Math.max(ay, by, cy), maxZ: Math.max(az, bz, cz),
    };
}

function buildOccluder (source: IAOBakeTarget): IOccluder {
    const triangles: ITriangle[] = [];
    let minX = Infinity; let minY = Infinity; let minZ = Infinity;
    let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;

    for (let primitiveIndex = 0; primitiveIndex < source.mesh.struct.primitives.length; ++primitiveIndex) {
        const primitive = source.mesh.struct.primitives[primitiveIndex];
        if (primitive.primitiveMode !== PrimitiveMode.TRIANGLE_LIST) continue;
        const positionData = source.mesh.readAttribute(primitiveIndex, AttributeName.ATTR_POSITION);
        if (!(positionData instanceof Float32Array)) continue;
        const indices = source.mesh.readIndices(primitiveIndex);
        const triangleCount = indices ? Math.floor(indices.length / 3) : Math.floor(positionData.length / 9);
        for (let triangleIndex = 0; triangleIndex < triangleCount; ++triangleIndex) {
            const i0 = indices ? indices[triangleIndex * 3] : triangleIndex * 3;
            const i1 = indices ? indices[triangleIndex * 3 + 1] : triangleIndex * 3 + 1;
            const i2 = indices ? indices[triangleIndex * 3 + 2] : triangleIndex * 3 + 2;
            const triangle = makeTriangle(positionData, i0, i1, i2, source.worldMatrix);
            triangles.push(triangle);
            minX = Math.min(minX, triangle.minX); minY = Math.min(minY, triangle.minY); minZ = Math.min(minZ, triangle.minZ);
            maxX = Math.max(maxX, triangle.maxX); maxY = Math.max(maxY, triangle.maxY); maxZ = Math.max(maxZ, triangle.maxZ);
        }
    }

    return { source, triangles, minX, minY, minZ, maxX, maxY, maxZ };
}

function rayAABB (
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    maxDistance: number,
): boolean {
    let tMin = 0;
    let tMax = maxDistance;

    const testAxis = (origin: number, direction: number, min: number, max: number): boolean => {
        if (Math.abs(direction) < 1e-8) return origin >= min && origin <= max;
        const inv = 1 / direction;
        let t1 = (min - origin) * inv;
        let t2 = (max - origin) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        return tMax >= tMin;
    };

    return testAxis(ox, dx, minX, maxX)
        && testAxis(oy, dy, minY, maxY)
        && testAxis(oz, dz, minZ, maxZ);
}

function rayTriangle (
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    triangle: ITriangle,
    maxDistance: number,
    doubleSided: boolean,
): boolean {
    const e1x = triangle.bx - triangle.ax;
    const e1y = triangle.by - triangle.ay;
    const e1z = triangle.bz - triangle.az;
    const e2x = triangle.cx - triangle.ax;
    const e2y = triangle.cy - triangle.ay;
    const e2z = triangle.cz - triangle.az;

    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    const epsilon = 1e-8;

    if (doubleSided) {
        if (Math.abs(det) < epsilon) return false;
    } else if (det < epsilon) {
        return false;
    }

    const invDet = 1 / det;
    const tx = ox - triangle.ax;
    const ty = oy - triangle.ay;
    const tz = oz - triangle.az;
    const u = (tx * px + ty * py + tz * pz) * invDet;
    if (u < 0 || u > 1) return false;

    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * invDet;
    if (v < 0 || u + v > 1) return false;

    const distance = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    return distance > 0 && distance <= maxDistance;
}

function isOccluded (
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDistance: number,
    occluders: readonly IOccluder[],
    target: IAOBakeTarget,
    options: IResolvedOptions,
): boolean {
    for (let occluderIndex = 0; occluderIndex < occluders.length; ++occluderIndex) {
        const occluder = occluders[occluderIndex];
        const isSelf = occluder.source === target;
        if (isSelf ? !options.selfOcclusion : !options.sceneOccluders) continue;
        if (!occluder.triangles.length) continue;
        if (!rayAABB(
            ox, oy, oz, dx, dy, dz,
            occluder.minX, occluder.minY, occluder.minZ,
            occluder.maxX, occluder.maxY, occluder.maxZ,
            maxDistance,
        )) continue;

        const triangles = occluder.triangles;
        for (let triangleIndex = 0; triangleIndex < triangles.length; ++triangleIndex) {
            const triangle = triangles[triangleIndex];
            if (!rayAABB(
                ox, oy, oz, dx, dy, dz,
                triangle.minX, triangle.minY, triangle.minZ,
                triangle.maxX, triangle.maxY, triangle.maxZ,
                maxDistance,
            )) continue;
            if (rayTriangle(ox, oy, oz, dx, dy, dz, triangle, maxDistance, options.doubleSided)) return true;
        }
    }
    return false;
}

function cloneStaticMeshWithAO (
    source: Mesh,
    values: readonly Float32Array[],
    channel: AOVertexColorChannel,
): Mesh {
    if (source.struct.dynamic) throw new Error('AO Baker v0.1 supports static meshes only.');
    if (source.struct.morph) throw new Error('AO Baker v0.1 does not support morph meshes.');
    if (source.struct.cluster || source.struct.primitives.some((primitive) => primitive.cluster)) {
        throw new Error('AO Baker v0.1 does not support clustered meshes.');
    }
    if (source.struct.compressed || source.struct.encoded || source.struct.quantized) {
        throw new Error('AO Baker requires an initialized/decompressed mesh.');
    }

    const originalStruct = source.struct;
    const primitives = originalStruct.primitives.map((primitive) => ({
        ...primitive,
        vertexBundelIndices: primitive.vertexBundelIndices.slice(),
        indexView: primitive.indexView ? { ...primitive.indexView } : undefined,
        cluster: undefined,
    }));

    const aoByBundle = new Map<number, Float32Array>();
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; ++primitiveIndex) {
        const primitive = primitives[primitiveIndex];
        if (primitive.vertexBundelIndices.length === 0) {
            throw new Error(`AO Baker found no vertex bundle on primitive ${primitiveIndex}.`);
        }
        const primaryBundleIndex = primitive.vertexBundelIndices[0];
        const primaryBundle = originalStruct.vertexBundles[primaryBundleIndex];
        if (primaryBundle.attributes.some((attribute) => attribute.name === AttributeName.ATTR_COLOR)) {
            throw new Error('AO Baker v0.1 cannot bake into a mesh that already contains ATTR_COLOR.');
        }

        const ao = values[primitiveIndex];
        if (ao.length !== primaryBundle.view.count) {
            throw new Error(`AO Baker vertex count mismatch on primitive ${primitiveIndex}.`);
        }

        const existing = aoByBundle.get(primaryBundleIndex);
        if (existing) {
            if (existing.length !== ao.length) throw new Error('Shared vertex bundle has incompatible AO data.');
            for (let i = 0; i < ao.length; ++i) {
                if (Math.abs(existing[i] - ao[i]) > 1e-5) {
                    throw new Error('Shared vertex bundle produced different AO values across primitives.');
                }
            }
        } else {
            aoByBundle.set(primaryBundleIndex, ao);
        }
    }

    const vertexBundles: Mesh.IVertexBundle[] = [];
    const vertexChunks: Uint8Array[] = [];
    let totalBytes = 0;
    const targetChannel = channelIndex(channel);

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

        const ao = aoByBundle.get(bundleIndex);
        let chunk: Uint8Array;
        let stride = sourceBundle.view.stride;
        if (ao) {
            const sourceStride = sourceBundle.view.stride;
            stride = sourceStride + 4;
            chunk = new Uint8Array(sourceBundle.view.count * stride);
            for (let vertexIndex = 0; vertexIndex < sourceBundle.view.count; ++vertexIndex) {
                const srcOffset = vertexIndex * sourceStride;
                const dstOffset = vertexIndex * stride;
                chunk.set(sourceBytes.subarray(srcOffset, srcOffset + sourceStride), dstOffset);
                chunk[dstOffset + sourceStride] = 255;
                chunk[dstOffset + sourceStride + 1] = 255;
                chunk[dstOffset + sourceStride + 2] = 255;
                chunk[dstOffset + sourceStride + 3] = 255;
                chunk[dstOffset + sourceStride + targetChannel] = Math.round(
                    Math.max(0, Math.min(1, ao[vertexIndex])) * 255,
                );
            }
            attributes.push(new Attribute(AttributeName.ATTR_COLOR, Format.RGBA8, true));
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
        vertexChunks.push(chunk);
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
    for (let i = 0; i < vertexChunks.length; ++i) {
        data.set(vertexChunks[i], writeOffset);
        writeOffset += vertexChunks[i].byteLength;
    }
    for (let i = 0; i < indexChunks.length; ++i) {
        data.set(indexChunks[i], writeOffset);
        writeOffset += indexChunks[i].byteLength;
    }

    const mesh = new Mesh(source.name ? `${source.name}-ao` : 'ao-baked-mesh');
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

/**
 * Offline/editor-oriented ambient-occlusion baker for static triangle meshes.
 *
 * The returned mesh is a clone with one compact RGBA8 vertex-color stream per
 * primitive. Only the selected channel is replaced with AO; the other channels
 * default to 1.0. v0.1 deliberately refuses meshes that already contain vertex
 * colors so imported source assets are never modified or silently corrupted.
 */
export function bakeMeshAmbientOcclusion (
    target: IAOBakeTarget,
    sceneOccluders: readonly IAOBakeTarget[] = [],
    bakeOptions?: IAOBakeOptions,
): IAOBakeResult {
    const start = Date.now();
    const options = resolveOptions(bakeOptions);
    const sources: IAOBakeTarget[] = [target];
    for (let i = 0; i < sceneOccluders.length; ++i) {
        if (sceneOccluders[i] !== target) sources.push(sceneOccluders[i]);
    }
    const occluders = sources.map(buildOccluder);

    const values: Float32Array[] = [];
    let totalVertices = 0;
    let totalAO = 0;
    let minAO = 1;
    let maxAO = 0;

    for (let primitiveIndex = 0; primitiveIndex < target.mesh.struct.primitives.length; ++primitiveIndex) {
        const primitive = target.mesh.struct.primitives[primitiveIndex];
        if (primitive.primitiveMode !== PrimitiveMode.TRIANGLE_LIST) {
            values.push(new Float32Array());
            continue;
        }

        const positionData = target.mesh.readAttribute(primitiveIndex, AttributeName.ATTR_POSITION);
        const normalData = target.mesh.readAttribute(primitiveIndex, AttributeName.ATTR_NORMAL);
        if (!(positionData instanceof Float32Array) || !(normalData instanceof Float32Array)) {
            throw new Error(`AO Baker requires Float32 position and normal attributes on primitive ${primitiveIndex}.`);
        }

        const vertexCount = Math.min(Math.floor(positionData.length / 3), Math.floor(normalData.length / 3));
        const primitiveAO = new Float32Array(vertexCount);
        values.push(primitiveAO);
        totalVertices += vertexCount;

        for (let vertexIndex = 0; vertexIndex < vertexCount; ++vertexIndex) {
            transformPoint(
                _position,
                positionData[vertexIndex * 3],
                positionData[vertexIndex * 3 + 1],
                positionData[vertexIndex * 3 + 2],
                target.worldMatrix,
            );
            transformNormal(
                _normal,
                normalData[vertexIndex * 3],
                normalData[vertexIndex * 3 + 1],
                normalData[vertexIndex * 3 + 2],
                target.worldMatrix,
            );

            const nx = _normal.x; const ny = _normal.y; const nz = _normal.z;
            const ox = _position.x + nx * options.rayBias;
            const oy = _position.y + ny * options.rayBias;
            const oz = _position.z + nz * options.rayBias;

            let tx: number; let ty: number; let tz: number;
            if (Math.abs(nz) < 0.999) {
                tx = -ny; ty = nx; tz = 0;
            } else {
                tx = 0; ty = -nz; tz = ny;
            }
            const tLength = Math.hypot(tx, ty, tz) || 1;
            tx /= tLength; ty /= tLength; tz /= tLength;
            const bx = ny * tz - nz * ty;
            const by = nz * tx - nx * tz;
            const bz = nx * ty - ny * tx;

            let blocked = 0;
            for (let sampleIndex = 0; sampleIndex < options.sampleCount; ++sampleIndex) {
                const u = (sampleIndex + 0.5) / options.sampleCount;
                const v = radicalInverseVdC(sampleIndex);
                const phi = 2 * Math.PI * v;
                const sinTheta = Math.sqrt(u);
                const cosTheta = Math.sqrt(1 - u);
                const lx = Math.cos(phi) * sinTheta;
                const ly = Math.sin(phi) * sinTheta;
                const lz = cosTheta;
                const dx = tx * lx + bx * ly + nx * lz;
                const dy = ty * lx + by * ly + ny * lz;
                const dz = tz * lx + bz * ly + nz * lz;

                if (isOccluded(ox, oy, oz, dx, dy, dz, options.maxDistance, occluders, target, options)) ++blocked;
            }

            const visibility = 1 - blocked / options.sampleCount;
            const ao = Math.pow(Math.max(0, Math.min(1, 1 - (1 - visibility) * options.strength)), options.contrast);
            primitiveAO[vertexIndex] = ao;
            totalAO += ao;
            minAO = Math.min(minAO, ao);
            maxAO = Math.max(maxAO, ao);
        }
    }

    const mesh = cloneStaticMeshWithAO(target.mesh, values, options.channel);
    return {
        mesh,
        values,
        stats: {
            vertexCount: totalVertices,
            rayCount: totalVertices * options.sampleCount,
            durationMs: Date.now() - start,
            minAO: totalVertices ? minAO : 1,
            averageAO: totalVertices ? totalAO / totalVertices : 1,
            maxAO: totalVertices ? maxAO : 1,
        },
    };
}
