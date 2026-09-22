const PACKAGE_NAME = 'playable-ao-baker';

interface BakeSettings {
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

function numberValue(element: HTMLInputElement, fallback: number): number {
    const value = Number(element.value);
    return Number.isFinite(value) ? value : fallback;
}

module.exports = Editor.Panel.define({
    template: require('fs').readFileSync(require('path').join(__dirname, '../../../static/template/default/index.html'), 'utf8'),
    style: require('fs').readFileSync(require('path').join(__dirname, '../../../static/style/default/index.css'), 'utf8'),

    $: {
        selection: '#selection',
        samples: '#samples',
        distance: '#distance',
        bias: '#bias',
        strength: '#strength',
        contrast: '#contrast',
        selfOcclusion: '#self-occlusion',
        sceneOccluders: '#scene-occluders',
        doubleSided: '#double-sided',
        channel: '#channel',
        output: '#output',
        refresh: '#refresh',
        preview: '#preview',
        restore: '#restore',
        bake: '#bake',
        status: '#status',
        stats: '#stats',
    },

    methods: {
        settings(): BakeSettings {
            return {
                sampleCount: Math.max(1, Math.floor(numberValue(this.$.samples as HTMLInputElement, 32))),
                maxDistance: Math.max(0, numberValue(this.$.distance as HTMLInputElement, 2)),
                rayBias: Math.max(0, numberValue(this.$.bias as HTMLInputElement, 0.002)),
                strength: Math.max(0, numberValue(this.$.strength as HTMLInputElement, 1)),
                contrast: Math.max(0.0001, numberValue(this.$.contrast as HTMLInputElement, 1)),
                selfOcclusion: (this.$.selfOcclusion as HTMLInputElement).checked,
                sceneOccluders: (this.$.sceneOccluders as HTMLInputElement).checked,
                doubleSided: (this.$.doubleSided as HTMLInputElement).checked,
                channel: (this.$.channel as HTMLSelectElement).value as BakeSettings['channel'],
            };
        },

        async refreshSelection() {
            const selection = await Editor.Message.request(PACKAGE_NAME, 'query-selection') as Array<{ name: string; meshName: string }>;
            (this.$.selection as HTMLElement).textContent = selection.length
                ? selection.map((item) => `${item.name} — ${item.meshName || '(unnamed mesh)'}`).join('\n')
                : 'No selected MeshRenderer.';
        },

        setBusy(busy: boolean, message = '') {
            for (const key of ['refresh', 'preview', 'restore', 'bake'] as const) {
                (this.$[key] as HTMLButtonElement).disabled = busy;
            }
            (this.$.status as HTMLElement).textContent = message;
        },

        showStats(items: Array<{ nodeName?: string; stats: any }>) {
            (this.$.stats as HTMLElement).textContent = items.map((item) => {
                const s = item.stats;
                return `${item.nodeName || 'Mesh'}\nvertices: ${s.vertexCount}\nrays: ${s.rayCount}\ntime: ${s.durationMs} ms\nAO: ${s.minAO.toFixed(3)} / ${s.averageAO.toFixed(3)} / ${s.maxAO.toFixed(3)}`;
            }).join('\n\n');
        },

        async runPreview() {
            this.setBusy(true, 'Baking preview…');
            try {
                const result = await Editor.Message.request(PACKAGE_NAME, 'preview', this.settings()) as any[];
                this.showStats(result);
                this.setBusy(false, 'Preview applied. Restore before changing selection.');
            } catch (error) {
                this.setBusy(false, error instanceof Error ? error.message : String(error));
            }
        },

        async runRestore() {
            this.setBusy(true, 'Restoring…');
            try {
                const result = await Editor.Message.request(PACKAGE_NAME, 'restore') as { restored: number };
                this.setBusy(false, `Restored ${result.restored} renderer(s).`);
            } catch (error) {
                this.setBusy(false, error instanceof Error ? error.message : String(error));
            }
        },

        async runBake() {
            this.setBusy(true, 'Baking and creating Mesh assets…');
            try {
                const output = (this.$.output as HTMLInputElement).value.trim() || 'db://assets';
                const result = await Editor.Message.request(PACKAGE_NAME, 'bake', this.settings(), output) as any[];
                this.showStats(result.map((item) => ({ nodeName: item.url, stats: item.stats })));
                this.setBusy(false, `Created ${result.length} mesh asset(s).`);
                await this.refreshSelection();
            } catch (error) {
                this.setBusy(false, error instanceof Error ? error.message : String(error));
            }
        },
    },

    async ready() {
        (this.$.refresh as HTMLButtonElement).addEventListener('click', () => void this.refreshSelection());
        (this.$.preview as HTMLButtonElement).addEventListener('click', () => void this.runPreview());
        (this.$.restore as HTMLButtonElement).addEventListener('click', () => void this.runRestore());
        (this.$.bake as HTMLButtonElement).addEventListener('click', () => void this.runBake());
        await this.refreshSelection();
    },
});
