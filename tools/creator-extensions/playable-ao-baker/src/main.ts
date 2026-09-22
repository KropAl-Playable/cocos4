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

interface SerializedBake {
    nodeUuid: string;
    nodeName: string;
    serializedMesh: string;
    stats: {
        vertexCount: number;
        rayCount: number;
        durationMs: number;
        minAO: number;
        averageAO: number;
        maxAO: number;
    };
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
        const baked = await executeScene('serializeBakedMeshes', [uuids, options]) as SerializedBake[];
        const created: Array<{ nodeUuid: string; url: string; uuid: string; stats: SerializedBake['stats'] }> = [];

        for (const item of baked) {
            const requestedUrl = `${directory}/${sanitizeAssetName(item.nodeName)}-ao.mesh`;
            const url = await Editor.Message.request('asset-db', 'generate-available-url', requestedUrl);
            const info = await Editor.Message.request('asset-db', 'create-asset', url, item.serializedMesh);
            if (!info) throw new Error(`Asset DB failed to create ${url}`);
            created.push({ nodeUuid: item.nodeUuid, url, uuid: info.uuid, stats: item.stats });
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
