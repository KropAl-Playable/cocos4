const PACKAGE_NAME = 'playable-ao-baker';

interface BakeOptions {
    sampleCount: number;
    maxDistance: number;
    rayBias: number;
    strength: number;
    contrast: number;
    selfOcclusion: boolean;
    sceneOccluders: boolean;
    doubleSided: boolean;
    channel: 'r' | 'g' | 'b' | 'a';
}

interface ExportedBake {
    nodeUuid: string;
    nodeName: string;
    glbBase64: string;
    stats: {
        vertexCount: number;
        rayCount: number;
        durationMs: number;
        minAO: number;
        averageAO: number;
        maxAO: number;
    };
}

interface AssetInfoLike {
    uuid: string;
    type?: string;
    subAssets?: Record<string, AssetInfoLike>;
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

export const methods: Record<string, (...args: any[]) => any> = {
    open() {
        Editor.Panel.open(PACKAGE_NAME);
    },

    async querySelection() {
        return executeScene('describeSelection', [selectedNodeUuids()]);
    },

    async preview(options: BakeOptions) {
        const uuids = selectedNodeUuids();
        if (!uuids.length) throw new Error('Select at least one node with a MeshRenderer.');
        return executeScene('preview', [uuids, options]);
    },

    async restore() {
        return executeScene('restorePreview');
    },

    async bake(options: BakeOptions, outputDirectory: string) {
        const uuids = selectedNodeUuids();
        if (!uuids.length) throw new Error('Select at least one node with a MeshRenderer.');

        const directory = (outputDirectory || 'db://assets').replace(/\/$/, '');
        const baked = await executeScene('exportBakedMeshes', [uuids, options]) as ExportedBake[];
        const created: Array<{ nodeUuid: string; url: string; uuid: string; stats: ExportedBake['stats'] }> = [];

        for (const item of baked) {
            const requestedUrl = `${directory}/${sanitizeAssetName(item.nodeName)}-ao.glb`;
            const url = await Editor.Message.request('asset-db', 'generate-available-url', requestedUrl);
            const glb = Buffer.from(item.glbBase64, 'base64');
            const info = await Editor.Message.request('asset-db', 'create-asset', url, glb);
            if (!info) throw new Error(`Asset DB failed to create ${url}`);

            const mesh = findMeshSubAsset(info as AssetInfoLike) || await queryImportedMesh(url);
            created.push({
                nodeUuid: item.nodeUuid,
                url,
                uuid: mesh.uuid,
                stats: item.stats,
            });
        }

        await executeScene('assignBakedAssets', [created.map((item) => ({
            nodeUuid: item.nodeUuid,
            assetUuid: item.uuid,
        }))]);

        return created;
    },
};

export function load(): void {}
export function unload(): void {}
