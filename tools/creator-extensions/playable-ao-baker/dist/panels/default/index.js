"use strict";
const PACKAGE_NAME = 'playable-ao-baker';
function numberValue(element, fallback) {
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
        sharingMode: '#sharing-mode',
        output: '#output',
        refresh: '#refresh',
        preview: '#preview',
        restore: '#restore',
        bake: '#bake',
        status: '#status',
        stats: '#stats',
    },
    methods: {
        settings() {
            return {
                sampleCount: Math.max(1, Math.floor(numberValue(this.$.samples, 32))),
                maxDistance: Math.max(0, numberValue(this.$.distance, 2)),
                rayBias: Math.max(0, numberValue(this.$.bias, 0.002)),
                strength: Math.max(0, numberValue(this.$.strength, 1)),
                contrast: Math.max(0.0001, numberValue(this.$.contrast, 1)),
                selfOcclusion: this.$.selfOcclusion.checked,
                sceneOccluders: this.$.sceneOccluders.checked,
                doubleSided: this.$.doubleSided.checked,
                channel: this.$.channel.value,
                sharingMode: this.$.sharingMode.value,
            };
        },
        async refreshSelection() {
            const selection = await Editor.Message.request(PACKAGE_NAME, 'query-selection');
            this.$.selection.textContent = selection.length
                ? selection.map((item) => `${item.name} — ${item.meshName || '(unnamed mesh)'}`).join('\n')
                : 'No selected MeshRenderer.';
        },
        setBusy(busy, message = '') {
            for (const key of ['refresh', 'preview', 'restore', 'bake']) {
                this.$[key].disabled = busy;
            }
            this.$.status.textContent = message;
        },
        showStats(items) {
            this.$.stats.textContent = items.map((item) => {
                const s = item.stats;
                return `${item.nodeName || 'Mesh'}\nvertices: ${s.vertexCount}\nrays: ${s.rayCount}\ntime: ${s.durationMs} ms\nAO: ${s.minAO.toFixed(3)} / ${s.averageAO.toFixed(3)} / ${s.maxAO.toFixed(3)}`;
            }).join('\n\n');
        },
        async runPreview() {
            this.setBusy(true, 'Baking preview…');
            try {
                const result = await Editor.Message.request(PACKAGE_NAME, 'preview', this.settings());
                this.showStats(result);
                this.setBusy(false, 'Preview applied. Restore before changing selection.');
            }
            catch (error) {
                this.setBusy(false, error instanceof Error ? error.message : String(error));
            }
        },
        async runRestore() {
            this.setBusy(true, 'Restoring…');
            try {
                const result = await Editor.Message.request(PACKAGE_NAME, 'restore');
                this.setBusy(false, `Restored ${result.restored} renderer(s).`);
            }
            catch (error) {
                this.setBusy(false, error instanceof Error ? error.message : String(error));
            }
        },
        async runBake() {
            this.setBusy(true, 'Baking and creating Mesh assets…');
            try {
                const output = this.$.output.value.trim() || 'db://assets';
                const result = await Editor.Message.request(PACKAGE_NAME, 'bake', this.settings(), output);
                this.showStats(result.assets.map((item) => ({ nodeName: item.url, stats: item.stats })));
                this.setBusy(false, `Assigned ${result.assignedCount} renderer(s) using ${result.uniqueAssetCount} unique mesh asset(s).`);
                await this.refreshSelection();
            }
            catch (error) {
                this.setBusy(false, error instanceof Error ? error.message : String(error));
            }
        },
    },
    async ready() {
        this.$.refresh.addEventListener('click', () => void this.refreshSelection());
        this.$.preview.addEventListener('click', () => void this.runPreview());
        this.$.restore.addEventListener('click', () => void this.runRestore());
        this.$.bake.addEventListener('click', () => void this.runBake());
        await this.refreshSelection();
    },
});
