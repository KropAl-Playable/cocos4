import { join } from 'path';

module.paths.push(join(Editor.App.path, 'node_modules'));

import type { Mesh, MeshRenderer, Node } from 'cc';

interface ExportedBake {
    nodeUuids: string[];
    nodeName: string;
    glbBase64: string;
    controlCount: number;
    vertexCount: number;
    reusedSourceData: boolean;
}

const ATTRIBUTE = {
    POSITION: 'a_position',
    NORMAL: 'a_normal',
    TANGENT: 'a_tangent',
    TEXCOORD0: 'a_texCoord',
    TEXCOORD1: 'a_texCoord1',
    COLOR0: 'a_color',
    TEXCOORD2: 'a_texCoord2',
    TEXCOORD3: 'a_texCoord3',
    TEXCOORD4: 'a_texCoord4',
    TEXCOORD5: 'a_texCoord5',
};

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

function selected(uuids: string[]): Array<{ node: Node; renderer: MeshRenderer; mesh: Mesh }> {
    const { director, MeshRenderer } = engine();
    const scene = director.getScene();
    if (!scene) throw new Error('No active scene.');

    const result: Array<{ node: Node; renderer: MeshRenderer; mesh: Mesh }> = [];
    for (const uuid of uuids) {
        const node = findNode(scene, uuid);
        if (!node) continue;
        const renderer = node.getComponent(MeshRenderer);
        if (!renderer?.mesh) continue;
        result.push({ node, renderer, mesh: renderer.mesh });
    }
    return result;
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
    for (let i = 0; i + 2 < data.length; i += 3) {
        min[0] = Math.min(min[0], data[i]);
        min[1] = Math.min(min[1], data[i + 1]);
        min[2] = Math.min(min[2], data[i + 2]);
        max[0] = Math.max(max[0], data[i]);
        max[1] = Math.max(max[1], data[i + 1]);
        max[2] = Math.max(max[2], data[i + 2]);
    }
    return { min, max };
}

function exportMeshToGLB(mesh: Mesh): Buffer {
    mesh.initialize();

    const bufferViews: any[] = [];
    const accessors: any[] = [];
    const primitives: any[] = [];
    const binaryParts: Buffer[] = [];
    let binaryLength = 0;

    const append = (
        data: ArrayBufferView,
        componentType: number,
        count: number,
        type: string,
        target: number,
        normalized = false,
        min?: number[],
        max?: number[],
    ): number => {
        const pad = (4 - (binaryLength & 3)) & 3;
        if (pad) {
            binaryParts.push(Buffer.alloc(pad));
            binaryLength += pad;
        }

        const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        const bufferView = bufferViews.length;
        bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: bytes.byteLength, target });
        binaryParts.push(bytes);
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
        attributeName: string,
        semantic: string,
        components: 2 | 3 | 4,
        attributes: Record<string, number>,
    ): void => {
        const raw = mesh.readAttribute(primitiveIndex, attributeName as any);
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

    const addColorAttribute = (
        primitiveIndex: number,
        attributeName: string,
        semantic: string,
        attributes: Record<string, number>,
    ): void => {
        const raw = mesh.readAttribute(primitiveIndex, attributeName as any);
        if (!raw) return;
        const count = Math.floor(raw.length / 4);
        if (!count) return;
        if (raw instanceof Uint8Array) {
            attributes[semantic] = append(raw, 5121, count, 'VEC4', 34962, true);
        } else {
            attributes[semantic] = append(asFloat32(raw), 5126, count, 'VEC4', 34962);
        }
    };

    const addTexCoordAttribute = (
        primitiveIndex: number,
        attributeName: string,
        semantic: string,
        attributes: Record<string, number>,
    ): void => {
        const raw = mesh.readAttribute(primitiveIndex, attributeName as any);
        if (!raw) return;
        const count = Math.floor(raw.length / 2);
        if (!count) return;
        if (raw instanceof Uint8Array) {
            attributes[semantic] = append(raw, 5121, count, 'VEC2', 34962, true);
        } else if (raw instanceof Uint16Array) {
            attributes[semantic] = append(raw, 5123, count, 'VEC2', 34962, true);
        } else {
            attributes[semantic] = append(asFloat32(raw), 5126, count, 'VEC2', 34962);
        }
    };

    for (let primitiveIndex = 0; primitiveIndex < mesh.struct.primitives.length; ++primitiveIndex) {
        const positionsRaw = mesh.readAttribute(primitiveIndex, ATTRIBUTE.POSITION as any);
        const normalsRaw = mesh.readAttribute(primitiveIndex, ATTRIBUTE.NORMAL as any);
        if (!positionsRaw || !normalsRaw) {
            throw new Error(`Cage GLB export requires POSITION and NORMAL on primitive ${primitiveIndex}.`);
        }

        const positions = asFloat32(positionsRaw);
        const normals = asFloat32(normalsRaw);
        const vertexCount = Math.floor(positions.length / 3);
        const bounds = positionBounds(positions);
        const attributes: Record<string, number> = {
            POSITION: append(positions, 5126, vertexCount, 'VEC3', 34962, false, bounds.min, bounds.max),
            NORMAL: append(normals, 5126, Math.floor(normals.length / 3), 'VEC3', 34962),
        };

        addFloatAttribute(primitiveIndex, ATTRIBUTE.TANGENT, 'TANGENT', 4, attributes);
        addFloatAttribute(primitiveIndex, ATTRIBUTE.TEXCOORD0, 'TEXCOORD_0', 2, attributes);
        addFloatAttribute(primitiveIndex, ATTRIBUTE.TEXCOORD1, 'TEXCOORD_1', 2, attributes);
        addColorAttribute(primitiveIndex, ATTRIBUTE.COLOR0, 'COLOR_0', attributes);
        addTexCoordAttribute(primitiveIndex, ATTRIBUTE.TEXCOORD2, 'TEXCOORD_2', attributes);
        addTexCoordAttribute(primitiveIndex, ATTRIBUTE.TEXCOORD3, 'TEXCOORD_3', attributes);
        addTexCoordAttribute(primitiveIndex, ATTRIBUTE.TEXCOORD4, 'TEXCOORD_4', attributes);
        addTexCoordAttribute(primitiveIndex, ATTRIBUTE.TEXCOORD5, 'TEXCOORD_5', attributes);

        if (
            attributes.TEXCOORD_2 === undefined
            || attributes.TEXCOORD_3 === undefined
            || attributes.TEXCOORD_4 === undefined
            || attributes.TEXCOORD_5 === undefined
        ) {
            throw new Error('Cage bake did not produce TEXCOORD_2..5 influence streams.');
        }

        const primitive: any = { attributes, mode: 4 };
        const indices = mesh.readIndices(primitiveIndex);
        if (indices) {
            const componentType = indices instanceof Uint8Array ? 5121 : indices instanceof Uint16Array ? 5123 : 5125;
            primitive.indices = append(indices, componentType, indices.length, 'SCALAR', 34963);
        }
        primitives.push(primitive);
    }

    const bin = Buffer.concat(binaryParts, binaryLength);
    const gltf = {
        asset: { version: '2.0', generator: 'COCOS 4 Playable Cage Baker' },
        buffers: [{ byteLength: bin.byteLength }],
        bufferViews,
        accessors,
        meshes: [{ name: mesh.name || 'Cage Baked Mesh', primitives }],
        nodes: [{ name: mesh.name || 'Cage Baked Mesh', mesh: 0 }],
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
export function unload(): void {}

export const methods = {
    describeSelection(uuids: string[]) {
        return selected(uuids).map((item) => ({
            uuid: item.node.uuid,
            name: item.node.name,
            meshName: item.mesh.name || '',
        }));
    },

    exportBakedMeshes(uuids: string[], controlCount: number): ExportedBake[] {
        const items = selected(uuids);
        if (!items.length) throw new Error('Selection contains no MeshRenderer with a Mesh.');

        const count = Math.max(2, Math.min(8, Math.floor(controlCount || 7)));
        const { createCageInfluenceMesh, hasCageInfluenceData } = baker();
        const groups = new Map<Mesh, typeof items>();

        for (const item of items) {
            const group = groups.get(item.mesh);
            if (group) group.push(item);
            else groups.set(item.mesh, [item]);
        }

        const output: ExportedBake[] = [];
        for (const group of groups.values()) {
            const source = group[0].mesh;
            const reusedSourceData = hasCageInfluenceData(source);
            const baked = reusedSourceData ? source : createCageInfluenceMesh(source, count);

            let vertexCount = 0;
            for (const bundle of baked.struct.vertexBundles) vertexCount += bundle.view.count;

            output.push({
                nodeUuids: group.map((item) => item.node.uuid),
                nodeName: source.name || group[0].node.name,
                glbBase64: exportMeshToGLB(baked).toString('base64'),
                controlCount: count,
                vertexCount,
                reusedSourceData,
            });

            if (!reusedSourceData) baked.destroy();
        }
        return output;
    },

    async assignBakedAssets(items: Array<{ nodeUuid: string; assetUuid: string; controlCount: number }>) {
        const cc = engine() as any;
        const { assetManager } = cc;

        for (const item of items) {
            const renderer = selected([item.nodeUuid])[0]?.renderer;
            if (!renderer) continue;

            const mesh = await new Promise<Mesh>((resolve, reject) => {
                assetManager.loadAny(item.assetUuid, (err: Error | null, asset: any) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    if (!asset || asset.constructor?.name !== 'Mesh') {
                        reject(new Error(`Asset ${item.assetUuid} is not a Mesh.`));
                        return;
                    }
                    resolve(asset as Mesh);
                });
            });
            renderer.mesh = mesh;

            const CageDeformer = cc.CageDeformer;
            if (CageDeformer) {
                const deformer = renderer.node.getComponent(CageDeformer);
                if (deformer) (deformer as any).controlCount = item.controlCount;
            }
        }
        return true;
    },
};
