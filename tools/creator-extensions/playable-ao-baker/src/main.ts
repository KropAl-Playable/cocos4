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
    sharingMode: 'auto' | 'shared-source' | 'per-instance';
}

interface ExportedBake {
    nodeUuids: string[];
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
        const sharingMode = options.sharingMode || 'auto';
        const sceneMode = sharingMode === 'shared-source' ? 'shared-source' : 'per-instance';
        const baked = await executeScene('exportBakedMeshes', [uuids, options, sceneMode]) as ExportedBake[];

        const created: Array<{
            nodeUuids: string[];
            url: string;
            uuid: string;
            stats: ExportedBake['stats'];
            reused: boolean;
        }> = [];

        // Automatic exact-content dedupe is safe even in per-instance mode.
        // If two AO results are byte-identical, import only one GLB and share its Mesh.
        const importedByGLB = new Map<string, { url: string; uuid: string }>();

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
            if (!info) throw new Error(`Asset DB failed to create ${url}`);

            const mesh = findMeshSubAsset(info as AssetInfoLike) || await queryImportedMesh(url);
            importedByGLB.set(item.glbBase64, { url, uuid: mesh.uuid });
            created.push({
                nodeUuids: item.nodeUuids,
                url,
                uuid: mesh.uuid,
                stats: item.stats,
                reused: false,
            });
        }

        const assignments: Array<{ nodeUuid: string; assetUuid: string }> = [];
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

export function load(): void {}
export function unload(): void {}
