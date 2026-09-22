"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.methods = exports.unload = exports.load = void 0;
const path_1 = require("path");
module.paths.push((0, path_1.join)(Editor.App.path, 'node_modules'));
const previewEntries = new Map();
let previewMaterial = null;
function engine() {
    return require('cc');
}
function baker() {
    return require('cc/editor/serialization');
}
function findNode(root, uuid) {
    if (root.uuid === uuid)
        return root;
    for (const child of root.children) {
        const found = findNode(child, uuid);
        if (found)
            return found;
    }
    return null;
}
function collectRenderers(root, out) {
    const { MeshRenderer } = engine();
    const renderer = root.getComponent(MeshRenderer);
    if (renderer === null || renderer === void 0 ? void 0 : renderer.mesh)
        out.push(renderer);
    for (const child of root.children)
        collectRenderers(child, out);
}
function rendererForUuid(uuid) {
    const { director, MeshRenderer } = engine();
    const scene = director.getScene();
    if (!scene)
        return null;
    const node = findNode(scene, uuid);
    if (!node)
        return null;
    return node.getComponent(MeshRenderer);
}
function targetForRenderer(renderer) {
    if (!renderer.mesh)
        return null;
    return {
        mesh: renderer.mesh,
        worldMatrix: renderer.node.worldMatrix,
    };
}
function selectedTargets(uuids) {
    const { director, MeshRenderer } = engine();
    const scene = director.getScene();
    if (!scene)
        throw new Error('No active scene.');
    const result = [];
    for (const uuid of uuids) {
        const node = findNode(scene, uuid);
        if (!node)
            continue;
        const renderer = node.getComponent(MeshRenderer);
        if (!(renderer === null || renderer === void 0 ? void 0 : renderer.mesh))
            continue;
        result.push({
            node,
            renderer,
            target: {
                mesh: renderer.mesh,
                worldMatrix: node.worldMatrix,
            },
        });
    }
    return result;
}
function sceneOccluders(excludedUuids) {
    const { director } = engine();
    const scene = director.getScene();
    if (!scene)
        return [];
    const renderers = [];
    collectRenderers(scene, renderers);
    const result = [];
    for (const renderer of renderers) {
        if (!renderer.mesh || excludedUuids.has(renderer.node.uuid))
            continue;
        const target = targetForRenderer(renderer);
        if (target)
            result.push(target);
    }
    return result;
}
function getPreviewMaterial() {
    if (previewMaterial === null || previewMaterial === void 0 ? void 0 : previewMaterial.isValid)
        return previewMaterial;
    const { Material } = engine();
    const material = new Material('AO Preview');
    material.initialize({
        effectName: 'builtin-unlit',
        defines: {
            USE_VERTEX_COLOR: true,
            USE_TEXTURE: false,
            USE_ALPHA_TEST: false,
        },
    });
    previewMaterial = material;
    return material;
}
function restorePreviewInternal() {
    let count = 0;
    for (const [uuid, entry] of previewEntries) {
        if (entry.renderer.isValid) {
            entry.renderer.mesh = entry.originalMesh;
            entry.renderer.sharedMaterials = entry.originalMaterials;
            ++count;
        }
        entry.previewMesh.destroy();
        previewEntries.delete(uuid);
    }
    if (previewMaterial === null || previewMaterial === void 0 ? void 0 : previewMaterial.isValid)
        previewMaterial.destroy();
    previewMaterial = null;
    return count;
}
function bakeSelection(uuids, options, debugPreview = false) {
    const selected = selectedTargets(uuids);
    if (!selected.length)
        throw new Error('Selection contains no MeshRenderer with a Mesh.');
    const excluded = new Set(selected.map((item) => item.node.uuid));
    const occluders = options.sceneOccluders ? sceneOccluders(excluded) : [];
    const { bakeMeshAmbientOcclusion } = baker();
    const bakeOptions = debugPreview ? { ...options, channel: 'rgb' } : options;
    return selected.map((item) => ({
        ...item,
        result: bakeMeshAmbientOcclusion(item.target, occluders, bakeOptions),
    }));
}
function asFloat32(data) {
    if (data instanceof Float32Array)
        return data;
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; ++i)
        out[i] = data[i];
    return out;
}
function positionBounds(data) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.length; i += 3) {
        min[0] = Math.min(min[0], data[i]);
        min[1] = Math.min(min[1], data[i + 1]);
        min[2] = Math.min(min[2], data[i + 2]);
        max[0] = Math.max(max[0], data[i]);
        max[1] = Math.max(max[1], data[i + 1]);
        max[2] = Math.max(max[2], data[i + 2]);
    }
    return { min, max };
}
const ATTRIBUTE = {
    POSITION: 'a_position',
    NORMAL: 'a_normal',
    TANGENT: 'a_tangent',
    TEXCOORD0: 'a_texCoord',
    TEXCOORD1: 'a_texCoord1',
    COLOR0: 'a_color',
};
function exportMeshToGLB(mesh) {
    const accessors = [];
    const bufferViews = [];
    const binaryParts = [];
    const primitives = [];
    let binaryLength = 0;
    const append = (data, componentType, count, type, target, normalized, min, max) => {
        const padding = (4 - (binaryLength & 3)) & 3;
        if (padding) {
            binaryParts.push(Buffer.alloc(padding));
            binaryLength += padding;
        }
        const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        const bufferView = bufferViews.length;
        bufferViews.push({
            buffer: 0,
            byteOffset: binaryLength,
            byteLength: bytes.byteLength,
            ...(target ? { target } : {}),
        });
        binaryParts.push(Buffer.from(bytes));
        binaryLength += bytes.byteLength;
        const accessor = accessors.length;
        accessors.push({
            bufferView,
            componentType,
            count,
            type,
            ...(normalized ? { normalized: true } : {}),
            ...(min ? { min } : {}),
            ...(max ? { max } : {}),
        });
        return accessor;
    };
    const addFloatAttribute = (primitiveIndex, attributeName, semantic, components, attributes) => {
        const raw = mesh.readAttribute(primitiveIndex, attributeName);
        if (!raw)
            return;
        const data = asFloat32(raw);
        const count = Math.floor(data.length / components);
        if (!count)
            return;
        attributes[semantic] = append(data, 5126, count, components === 2 ? 'VEC2' : components === 3 ? 'VEC3' : 'VEC4', 34962);
    };
    for (let primitiveIndex = 0; primitiveIndex < mesh.struct.primitives.length; ++primitiveIndex) {
        const positionsRaw = mesh.readAttribute(primitiveIndex, ATTRIBUTE.POSITION);
        const normalsRaw = mesh.readAttribute(primitiveIndex, ATTRIBUTE.NORMAL);
        if (!positionsRaw || !normalsRaw) {
            throw new Error(`GLB export requires POSITION and NORMAL on primitive ${primitiveIndex}.`);
        }
        const positions = asFloat32(positionsRaw);
        const normals = asFloat32(normalsRaw);
        const vertexCount = Math.floor(positions.length / 3);
        const bounds = positionBounds(positions);
        const attributes = {
            POSITION: append(positions, 5126, vertexCount, 'VEC3', 34962, false, bounds.min, bounds.max),
            NORMAL: append(normals, 5126, Math.floor(normals.length / 3), 'VEC3', 34962),
        };
        addFloatAttribute(primitiveIndex, ATTRIBUTE.TANGENT, 'TANGENT', 4, attributes);
        addFloatAttribute(primitiveIndex, ATTRIBUTE.TEXCOORD0, 'TEXCOORD_0', 2, attributes);
        addFloatAttribute(primitiveIndex, ATTRIBUTE.TEXCOORD1, 'TEXCOORD_1', 2, attributes);
        const colors = mesh.readAttribute(primitiveIndex, ATTRIBUTE.COLOR0);
        if (colors) {
            const colorCount = Math.floor(colors.length / 4);
            if (colors instanceof Uint8Array) {
                attributes.COLOR_0 = append(colors, 5121, colorCount, 'VEC4', 34962, true);
            }
            else {
                attributes.COLOR_0 = append(asFloat32(colors), 5126, colorCount, 'VEC4', 34962);
            }
        }
        const primitive = {
            attributes,
            mode: 4,
        };
        const indices = mesh.readIndices(primitiveIndex);
        if (indices) {
            const componentType = indices instanceof Uint8Array ? 5121 : indices instanceof Uint16Array ? 5123 : 5125;
            primitive.indices = append(indices, componentType, indices.length, 'SCALAR', 34963);
        }
        primitives.push(primitive);
    }
    const bin = Buffer.concat(binaryParts, binaryLength);
    const gltf = {
        asset: {
            version: '2.0',
            generator: 'COCOS 4 Playable AO Baker',
        },
        buffers: [{ byteLength: bin.byteLength }],
        bufferViews,
        accessors,
        meshes: [{
                name: mesh.name || 'AO Baked Mesh',
                primitives,
            }],
        nodes: [{ name: mesh.name || 'AO Baked Mesh', mesh: 0 }],
        scenes: [{ nodes: [0] }],
        scene: 0,
    };
    const jsonSource = Buffer.from(JSON.stringify(gltf), 'utf8');
    const jsonPadding = (4 - (jsonSource.byteLength & 3)) & 3;
    const json = Buffer.concat([jsonSource, Buffer.alloc(jsonPadding, 0x20)]);
    const binPadding = (4 - (bin.byteLength & 3)) & 3;
    const paddedBin = binPadding ? Buffer.concat([bin, Buffer.alloc(binPadding)]) : bin;
    const totalLength = 12 + 8 + json.byteLength + 8 + paddedBin.byteLength;
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546C67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(totalLength, 8);
    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(json.byteLength, 0);
    jsonHeader.writeUInt32LE(0x4E4F534A, 4);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(paddedBin.byteLength, 0);
    binHeader.writeUInt32LE(0x004E4942, 4);
    return Buffer.concat([header, jsonHeader, json, binHeader, paddedBin], totalLength);
}
function load() { }
exports.load = load;
function unload() {
    restorePreviewInternal();
}
exports.unload = unload;
exports.methods = {
    describeSelection(uuids) {
        const selected = selectedTargets(uuids);
        return selected.map((item) => {
            var _a;
            return ({
                uuid: item.node.uuid,
                name: item.node.name,
                meshName: ((_a = item.renderer.mesh) === null || _a === void 0 ? void 0 : _a.name) || '',
            });
        });
    },
    preview(uuids, options) {
        restorePreviewInternal();
        const baked = bakeSelection(uuids, options, true);
        const material = getPreviewMaterial();
        const stats = [];
        for (const item of baked) {
            if (!item.renderer.mesh)
                continue;
            const originalMesh = item.renderer.mesh;
            const originalMaterials = item.renderer.sharedMaterials;
            previewEntries.set(item.node.uuid, {
                renderer: item.renderer,
                originalMesh,
                originalMaterials,
                previewMesh: item.result.mesh,
            });
            item.renderer.mesh = item.result.mesh;
            const materialCount = Math.max(1, originalMaterials.length, item.result.mesh.struct.primitives.length);
            item.renderer.sharedMaterials = new Array(materialCount).fill(material);
            stats.push({ nodeUuid: item.node.uuid, nodeName: item.node.name, stats: item.result.stats });
        }
        return stats;
    },
    restorePreview() {
        return { restored: restorePreviewInternal() };
    },
    exportBakedMeshes(uuids, options, sharingMode = 'per-instance') {
        var _a, _b;
        restorePreviewInternal();
        if (sharingMode === 'shared-source') {
            const selected = selectedTargets(uuids);
            if (!selected.length)
                throw new Error('Selection contains no MeshRenderer with a Mesh.');
            const { bakeMeshAmbientOcclusion, createMeshWithAmbientOcclusionValues } = baker();
            const groups = new Map();
            for (const item of selected) {
                const mesh = item.renderer.mesh;
                const group = groups.get(mesh);
                if (group)
                    group.push(item);
                else
                    groups.set(mesh, [item]);
            }
            const output = [];
            for (const group of groups.values()) {
                const representative = group[0];
                let averagedValues = null;
                let rayCount = 0;
                let durationMs = 0;
                // Bake every selected instance in its real scene position, then average
                // per-vertex AO back into one shared mesh. This preserves source-mesh
                // reuse while retaining a stable approximation of environment AO.
                for (const item of group) {
                    const occluders = options.sceneOccluders
                        ? sceneOccluders(new Set([item.node.uuid]))
                        : [];
                    const result = bakeMeshAmbientOcclusion(item.target, occluders, options);
                    if (!averagedValues) {
                        averagedValues = result.values.map((values) => new Float32Array(values.length));
                    }
                    for (let primitiveIndex = 0; primitiveIndex < result.values.length; ++primitiveIndex) {
                        const src = result.values[primitiveIndex];
                        const dst = averagedValues[primitiveIndex];
                        if (src.length !== dst.length) {
                            result.mesh.destroy();
                            throw new Error('Shared source mesh produced incompatible AO vertex counts.');
                        }
                        for (let vertexIndex = 0; vertexIndex < src.length; ++vertexIndex) {
                            dst[vertexIndex] += src[vertexIndex];
                        }
                    }
                    rayCount += result.stats.rayCount;
                    durationMs += result.stats.durationMs;
                    result.mesh.destroy();
                }
                if (!averagedValues)
                    continue;
                let vertexCount = 0;
                let totalAO = 0;
                let minAO = 1;
                let maxAO = 0;
                for (const values of averagedValues) {
                    for (let i = 0; i < values.length; ++i) {
                        values[i] /= group.length;
                        const value = values[i];
                        totalAO += value;
                        minAO = Math.min(minAO, value);
                        maxAO = Math.max(maxAO, value);
                    }
                    vertexCount += values.length;
                }
                const sharedMesh = createMeshWithAmbientOcclusionValues(representative.target.mesh, averagedValues, (_a = options.channel) !== null && _a !== void 0 ? _a : 'r');
                const stats = {
                    vertexCount,
                    rayCount,
                    durationMs,
                    minAO: vertexCount ? minAO : 1,
                    averageAO: vertexCount ? totalAO / vertexCount : 1,
                    maxAO: vertexCount ? maxAO : 1,
                };
                output.push({
                    nodeUuids: group.map((item) => item.node.uuid),
                    nodeName: ((_b = representative.renderer.mesh) === null || _b === void 0 ? void 0 : _b.name) || representative.node.name,
                    glbBase64: exportMeshToGLB(sharedMesh).toString('base64'),
                    stats,
                });
                sharedMesh.destroy();
            }
            return output;
        }
        const baked = bakeSelection(uuids, options, false);
        return baked.map((item) => ({
            nodeUuids: [item.node.uuid],
            nodeName: item.node.name,
            glbBase64: exportMeshToGLB(item.result.mesh).toString('base64'),
            stats: item.result.stats,
        }));
    },
    async assignBakedAssets(items) {
        const { assetManager, Mesh } = engine();
        for (const item of items) {
            const renderer = rendererForUuid(item.nodeUuid);
            if (!renderer)
                continue;
            const mesh = await new Promise((resolve, reject) => {
                assetManager.loadAny(item.assetUuid, (err, asset) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    if (!(asset instanceof Mesh)) {
                        reject(new Error(`Asset ${item.assetUuid} is not a Mesh.`));
                        return;
                    }
                    resolve(asset);
                });
            });
            renderer.mesh = mesh;
        }
        return true;
    },
};
