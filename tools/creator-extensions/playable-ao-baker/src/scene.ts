import { join } from 'path';

module.paths.push(join(Editor.App.path, 'node_modules'));

import type { Mesh, MeshRenderer, Node } from 'cc';
import type { IAOBakeOptions, IAOBakeStats, IAOBakeTarget } from 'cc/editor/serialization';

interface PreviewEntry {
    renderer: MeshRenderer;
    originalMesh: Mesh;
    previewMesh: Mesh;
}

interface SerializedBake {
    nodeUuid: string;
    nodeName: string;
    serializedMesh: string;
    stats: IAOBakeStats;
}

const previewEntries = new Map<string, PreviewEntry>();

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

function restorePreviewInternal(): number {
    let count = 0;
    for (const [uuid, entry] of previewEntries) {
        if (entry.renderer.isValid) {
            entry.renderer.mesh = entry.originalMesh;
            ++count;
        }
        entry.previewMesh.destroy();
        previewEntries.delete(uuid);
    }
    return count;
}

function bakeSelection(uuids: string[], options: IAOBakeOptions) {
    const selected = selectedTargets(uuids);
    if (!selected.length) throw new Error('Selection contains no MeshRenderer with a Mesh.');

    const excluded = new Set(selected.map((item) => item.node.uuid));
    const occluders = options.sceneOccluders ? sceneOccluders(excluded) : [];
    const { bakeMeshAmbientOcclusion } = baker();

    return selected.map((item) => ({
        ...item,
        result: bakeMeshAmbientOcclusion(item.target, occluders, options),
    }));
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
        const baked = bakeSelection(uuids, options);
        const stats: Array<{ nodeUuid: string; nodeName: string; stats: IAOBakeStats }> = [];

        for (const item of baked) {
            if (!item.renderer.mesh) continue;
            const originalMesh = item.renderer.mesh;
            previewEntries.set(item.node.uuid, {
                renderer: item.renderer,
                originalMesh,
                previewMesh: item.result.mesh,
            });
            item.renderer.mesh = item.result.mesh;
            stats.push({ nodeUuid: item.node.uuid, nodeName: item.node.name, stats: item.result.stats });
        }
        return stats;
    },

    restorePreview() {
        return { restored: restorePreviewInternal() };
    },

    serializeBakedMeshes(uuids: string[], options: IAOBakeOptions): SerializedBake[] {
        restorePreviewInternal();
        const baked = bakeSelection(uuids, options);
        return baked.map((item) => {
            const serialized = EditorExtends.serialize(item.result.mesh);
            return {
                nodeUuid: item.node.uuid,
                nodeName: item.node.name,
                serializedMesh: typeof serialized === 'string' ? serialized : JSON.stringify(serialized),
                stats: item.result.stats,
            };
        });
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
