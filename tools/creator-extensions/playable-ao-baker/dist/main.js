"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unload = exports.load = exports.methods = void 0;
const PACKAGE_NAME = 'playable-ao-baker';
function selectedNodeUuids() {
    return Editor.Selection.getSelected('node');
}
async function executeScene(method, args = []) {
    return Editor.Message.request('scene', 'execute-scene-script', {
        name: PACKAGE_NAME,
        method,
        args,
    });
}
function sanitizeAssetName(name) {
    const sanitized = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
    return sanitized || 'mesh';
}
function findMeshSubAsset(info) {
    if (!info)
        return null;
    if (info.type === 'cc.Mesh')
        return info;
    for (const subAsset of Object.values(info.subAssets || {})) {
        const found = findMeshSubAsset(subAsset);
        if (found)
            return found;
    }
    return null;
}
async function queryImportedMesh(url) {
    for (let attempt = 0; attempt < 20; ++attempt) {
        const info = await Editor.Message.request('asset-db', 'query-asset-info', url);
        const mesh = findMeshSubAsset(info);
        if (mesh)
            return mesh;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Imported GLB did not expose a cc.Mesh sub-asset: ${url}`);
}
exports.methods = {
    open() {
        Editor.Panel.open(PACKAGE_NAME);
    },
    async querySelection() {
        return executeScene('describeSelection', [selectedNodeUuids()]);
    },
    async preview(options) {
        const uuids = selectedNodeUuids();
        if (!uuids.length)
            throw new Error('Select at least one node with a MeshRenderer.');
        return executeScene('preview', [uuids, options]);
    },
    async restore() {
        return executeScene('restorePreview');
    },
    async bake(options, outputDirectory) {
        const uuids = selectedNodeUuids();
        if (!uuids.length)
            throw new Error('Select at least one node with a MeshRenderer.');
        const directory = (outputDirectory || 'db://assets').replace(/\/$/, '');
        const sharingMode = options.sharingMode || 'auto';
        const sceneMode = sharingMode === 'shared-source' ? 'shared-source' : 'per-instance';
        const baked = await executeScene('exportBakedMeshes', [uuids, options, sceneMode]);
        const created = [];
        // Automatic exact-content dedupe is safe even in per-instance mode.
        // If two AO results are byte-identical, import only one GLB and share its Mesh.
        const importedByGLB = new Map();
        for (const item of baked) {
            const cached = sharingMode !== 'per-instance' ? importedByGLB.get(item.glbBase64) : undefined;
            if (cached) {
                created.push({
                    nodeUuids: item.nodeUuids,
                    url: cached.url,
                    uuid: cached.uuid,
                    stats: item.stats,
                    reused: true,
                });
                continue;
            }
            const requestedUrl = `${directory}/${sanitizeAssetName(item.nodeName)}-ao.glb`;
            const url = await Editor.Message.request('asset-db', 'generate-available-url', requestedUrl);
            const glb = Buffer.from(item.glbBase64, 'base64');
            const info = await Editor.Message.request('asset-db', 'create-asset', url, glb);
            if (!info)
                throw new Error(`Asset DB failed to create ${url}`);
            const mesh = findMeshSubAsset(info) || await queryImportedMesh(url);
            importedByGLB.set(item.glbBase64, { url, uuid: mesh.uuid });
            created.push({
                nodeUuids: item.nodeUuids,
                url,
                uuid: mesh.uuid,
                stats: item.stats,
                reused: false,
            });
        }
        const assignments = [];
        for (const item of created) {
            for (const nodeUuid of item.nodeUuids) {
                assignments.push({ nodeUuid, assetUuid: item.uuid });
            }
        }
        await executeScene('assignBakedAssets', [assignments]);
        return {
            assets: created,
            assignedCount: assignments.length,
            uniqueAssetCount: new Set(created.map((item) => item.uuid)).size,
            sharingMode,
        };
    },
};
function load() { }
exports.load = load;
function unload() { }
exports.unload = unload;
