const PACKAGE_NAME = 'playable-cage-baker';

interface AssetInfoLike {
    uuid: string;
    type?: string;
    subAssets?: Record<string, AssetInfoLike>;
}

interface ExportedBake {
    nodeUuids: string[];
    nodeName: string;
    glbBase64: string;
    controlCount: number;
    vertexCount: number;
    reusedSourceData: boolean;
}

function selectedNodeUuids(): string[] {
    return Editor.Selection.getSelected('node');
}

async function executeScene(method: string, args: unknown[] = []): Promise<any> {
    return Editor.Message.request('scene', 'execute-scene-script', {
        name: PACKAGE_NAME,
        method,
        args,
    });
}

function sanitizeAssetName(name: string): string {
    const sanitized = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
    return sanitized || 'mesh';
}

function findMeshSubAsset(info: AssetInfoLike | null | undefined): AssetInfoLike | null {
    if (!info) return null;
    if (info.type === 'cc.Mesh') return info;
    for (const subAsset of Object.values(info.subAssets || {})) {
        const found = findMeshSubAsset(subAsset);
        if (found) return found;
    }
    return null;
}

async function queryImportedMesh(url: string): Promise<AssetInfoLike> {
    for (let attempt = 0; attempt < 20; ++attempt) {
        const info = await Editor.Message.request('asset-db', 'query-asset-info', url) as AssetInfoLike | null;
        const mesh = findMeshSubAsset(info);
        if (mesh) return mesh;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Imported GLB did not expose a cc.Mesh sub-asset: ${url}`);
}

async function bakeSelection(controlCount: number, outputDirectory: string) {
    const uuids = selectedNodeUuids();
    if (!uuids.length) throw new Error('Select at least one node with a MeshRenderer.');

    const count = Math.max(2, Math.min(8, Math.floor(controlCount || 7)));
    const directory = (outputDirectory || 'db://assets').replace(/\/$/, '');
    const baked = await executeScene('exportBakedMeshes', [uuids, count]) as ExportedBake[];

    const assignments: Array<{ nodeUuid: string; assetUuid: string; controlCount: number }> = [];
    const assets: Array<{ url: string; uuid: string; nodeUuids: string[]; vertexCount: number; reusedSourceData: boolean }> = [];

    for (const item of baked) {
        const requestedUrl = `${directory}/${sanitizeAssetName(item.nodeName)}-cage-${item.controlCount}.glb`;
        const url = await Editor.Message.request('asset-db', 'generate-available-url', requestedUrl);
        const glb = Buffer.from(item.glbBase64, 'base64');
        const info = await Editor.Message.request('asset-db', 'create-asset', url, glb);
        if (!info) throw new Error(`Asset DB failed to create ${url}`);

        const mesh = findMeshSubAsset(info as AssetInfoLike) || await queryImportedMesh(url);
        for (const nodeUuid of item.nodeUuids) {
            assignments.push({ nodeUuid, assetUuid: mesh.uuid, controlCount: item.controlCount });
        }
        assets.push({
            url,
            uuid: mesh.uuid,
            nodeUuids: item.nodeUuids,
            vertexCount: item.vertexCount,
            reusedSourceData: item.reusedSourceData,
        });
    }

    await executeScene('assignBakedAssets', [assignments]);
    return {
        assets,
        assignedCount: assignments.length,
        uniqueAssetCount: assets.length,
        controlCount: count,
    };
}

export const methods: Record<string, (...args: any[]) => any> = {
    open() {
        Editor.Panel.open(PACKAGE_NAME);
    },

    async querySelection() {
        return executeScene('describeSelection', [selectedNodeUuids()]);
    },

    async bake(controlCount: number, outputDirectory: string) {
        return bakeSelection(controlCount, outputDirectory);
    },

    async bakeCurrent(controlCount: number) {
        return bakeSelection(controlCount, 'db://assets');
    },
};

export function load(): void {}
export function unload(): void {}
