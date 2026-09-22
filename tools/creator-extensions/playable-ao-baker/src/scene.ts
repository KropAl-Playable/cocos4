import { join } from 'path';

module.paths.push(join(Editor.App.path, 'node_modules'));

import type { Material, Mesh, MeshRenderer, Node } from 'cc';
import type { IAOBakeOptions, IAOBakeStats, IAOBakeTarget } from 'cc/editor/serialization';

interface PreviewEntry {
    renderer: MeshRenderer;
    originalMesh: Mesh;
    originalMaterials: Array<Material | null>;
    previewMesh: Mesh;
}

interface ExportedBake {
    nodeUuid: string;
    nodeName: string;
    glbBase64: string;
    stats: IAOBakeStats;
}

const previewEntries = new Map<string, PreviewEntry>();
let previewMaterial: Material | null = null;

function engine(): typeof import('cc') {
    return require('cc') as typeof import('cc');
}

function baker(): typeof import('cc/editor/serialization') {
    return require('cc/editor/serialization') as typeof import('cc/editor/serialization');
}

function findNode(root: Node, uuid: string): Node | null {
    if (root.uuid === uuid) return root;
    for (const child of root.children) {
        const found = findNode(child, uuid);
        if (found) return found;
    }
    return null;
}

function collectRenderers(root: Node, out: MeshRenderer[]): void {
    const { MeshRenderer } = engine();
    const renderer = root.getComponent(MeshRenderer);
    if (renderer?.mesh) out.push(renderer);
    for (const child of root.children) collectRenderers(child, out);
}

function rendererForUuid(uuid: string): MeshRenderer | null {
    const { director, MeshRenderer } = engine();
    const scene = director.getScene();
    if (!scene) return null;
    const node = findNode(scene, uuid);
    if (!node) return null;
    return node.getComponent(MeshRenderer);
}

function targetForRenderer(renderer: MeshRenderer): IAOBakeTarget | null {
    if (!renderer.mesh) return null;
    return {
        mesh: renderer.mesh,
        worldMatrix: renderer.node.worldMatrix,
    };
}

function selectedTargets(uuids: string[]): Array<{ node: Node; renderer: MeshRenderer; target: IAOBakeTarget }> {
    const { director, MeshRenderer } = engine();
    const scene = director.getScene();
    if (!scene) throw new Error('No active scene.');

    const result: Array<{ node: Node; renderer: MeshRenderer; target: IAOBakeTarget }> = [];
    for (const uuid of uuids) {
        const node = findNode(scene, uuid);
        if (!node) continue;
        const renderer = node.getComponent(MeshRenderer);
        if (!renderer?.mesh) continue;
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

function sceneOccluders(excludedUuids: Set<string>): IAOBakeTarget[] {
    const { director } = engine();
    const scene = director.getScene();
    if (!scene) return [];

    const renderers: MeshRenderer[] = [];
    collectRenderers(scene, renderers);
    const result: IAOBakeTarget[] = [];
    for (const renderer of renderers) {
        if (!renderer.mesh || excludedUuids.has(renderer.node.uuid)) continue;
        const target = targetForRenderer(renderer);
        if (target) result.push(target);
    }
    return result;
}

function getPreviewMaterial(): Material {
    if (previewMaterial?.isValid) return previewMaterial;
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

function restorePreviewInternal(): number {
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
    if (previewMaterial?.isValid) previewMaterial.destroy();
    previewMaterial = null;
    return count;
}

function bakeSelection(uuids: string[], options: IAOBakeOptions, debugPreview = false) {
    const selected = selectedTargets(uuids);
    if (!selected.length) throw new Error('Selection contains no MeshRenderer with a Mesh.');

    const excluded = new Set(selected.map((item) => item.node.uuid));
    const occluders = options.sceneOccluders ? sceneOccluders(excluded) : [];
    const { bakeMeshAmbientOcclusion } = baker();
    const bakeOptions: IAOBakeOptions = debugPreview ? { ...options, channel: 'rgb' } : options;

    return selected.map((item) => ({
        ...item,
        result: bakeMeshAmbientOcclusion(item.target, occluders, bakeOptions),
    }));
}

interface GLTFAccessor {
    bufferView: number;
    componentType: number;
    count: number;
    type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4';
    normalized?: boolean;
    min?: number[];
    max?: number[];
}

interface GLTFBufferView {
    buffer: number;
    byteOffset: number;
    byteLength: number;
    target?: number;
}

function asFloat32(data: ArrayLike<number>): Float32Array {
    if (data instanceof Float32Array) return data;
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; ++i) out[i] = data[i];
    return out;
}

function positionBounds(data: Float32Array): { min: number[]; max: number[] } {
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
} as const;

function exportMeshToGLB(mesh: Mesh): Buffer {
    const accessors: GLTFAccessor[] = [];
    const bufferViews: GLTFBufferView[] = [];
    const binaryParts: Buffer[] = [];
    const primitives: any[] = [];
    let binaryLength = 0;

    const append = (
        data: ArrayBufferView,
        componentType: number,
        count: number,
        type: GLTFAccessor['type'],
        target?: number,
        normalized?: boolean,
        min?: number[],
        max?: number[],
    ): number => {
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

    const addFloatAttribute = (
        primitiveIndex: number,
        attributeName: any,
        semantic: string,
        components: 2 | 3 | 4,
        attributes: Record<string, number>,
    ): void => {
        const raw = mesh.readAttribute(primitiveIndex, attributeName);
        if (!raw) return;
        const data = asFloat32(raw);
        const count = Math.floor(data.length / components);
        if (!count) return;
        attributes[semantic] = append(
            data,
            5126,
            count,
            components === 2 ? 'VEC2' : components === 3 ? 'VEC3' : 'VEC4',
            34962,
        );
    };

    for (let primitiveIndex = 0; primitiveIndex < mesh.struct.primitives.length; ++primitiveIndex) {
        const positionsRaw = mesh.readAttribute(primitiveIndex, ATTRIBUTE.POSITION as any);
        const normalsRaw = mesh.readAttribute(primitiveIndex, ATTRIBUTE.NORMAL as any);
        if (!positionsRaw || !normalsRaw) {
            throw new Error(`GLB export requires POSITION and NORMAL on primitive ${primitiveIndex}.`);
        }

        const positions = asFloat32(positionsRaw);
        const normals = asFloat32(normalsRaw);
        const vertexCount = Math.floor(positions.length / 3);
        const bounds = positionBounds(positions);
        const attributes: Record<string, number> = {
            POSITION: append(positions, 5126, vertexCount, 'VEC3', 34962, false, bounds.min, bounds.max),
            NORMAL: append(normals, 5126, Math.floor(normals.length / 3), 'VEC3', 34962),
        };

        addFloatAttribute(primitiveIndex, ATTRIBUTE.TANGENT as any, 'TANGENT', 4, attributes);
        addFloatAttribute(primitiveIndex, ATTRIBUTE.TEXCOORD0 as any, 'TEXCOORD_0', 2, attributes);
        addFloatAttribute(primitiveIndex, ATTRIBUTE.TEXCOORD1 as any, 'TEXCOORD_1', 2, attributes);

        const colors = mesh.readAttribute(primitiveIndex, ATTRIBUTE.COLOR0 as any);
        if (colors) {
            const colorCount = Math.floor(colors.length / 4);
            if (colors instanceof Uint8Array) {
                attributes.COLOR_0 = append(colors, 5121, colorCount, 'VEC4', 34962, true);
            } else {
                attributes.COLOR_0 = append(asFloat32(colors), 5126, colorCount, 'VEC4', 34962);
            }
        }

        const primitive: any = {
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

export function load(): void {}

export function unload(): void {
    restorePreviewInternal();
}

export const methods = {
    describeSelection(uuids: string[]) {
        const selected = selectedTargets(uuids);
        return selected.map((item) => ({
            uuid: item.node.uuid,
            name: item.node.name,
            meshName: item.renderer.mesh?.name || '',
        }));
    },

    preview(uuids: string[], options: IAOBakeOptions) {
        restorePreviewInternal();
        const baked = bakeSelection(uuids, options, true);
        const material = getPreviewMaterial();
        const stats: Array<{ nodeUuid: string; nodeName: string; stats: IAOBakeStats }> = [];

        for (const item of baked) {
            if (!item.renderer.mesh) continue;
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
            item.renderer.sharedMaterials = new Array<Material | null>(materialCount).fill(material);
            stats.push({ nodeUuid: item.node.uuid, nodeName: item.node.name, stats: item.result.stats });
        }
        return stats;
    },

    restorePreview() {
        return { restored: restorePreviewInternal() };
    },

    exportBakedMeshes(uuids: string[], options: IAOBakeOptions): ExportedBake[] {
        restorePreviewInternal();
        const baked = bakeSelection(uuids, options, false);
        return baked.map((item) => ({
            nodeUuid: item.node.uuid,
            nodeName: item.node.name,
            glbBase64: exportMeshToGLB(item.result.mesh).toString('base64'),
            stats: item.result.stats,
        }));
    },

    async assignBakedAssets(items: Array<{ nodeUuid: string; assetUuid: string }>) {
        const { assetManager, Mesh } = engine();
        for (const item of items) {
            const renderer = rendererForUuid(item.nodeUuid);
            if (!renderer) continue;
            const mesh = await new Promise<Mesh>((resolve, reject) => {
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
