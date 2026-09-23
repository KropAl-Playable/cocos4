const PACKAGE_NAME = 'playable-cage-baker';

function numberValue(element: HTMLInputElement, fallback: number): number {
    const value = Number(element.value);
    return Number.isFinite(value) ? value : fallback;
}

module.exports = Editor.Panel.define({
    template: require('fs').readFileSync(require('path').join(__dirname, '../../../static/template/default/index.html'), 'utf8'),
    style: require('fs').readFileSync(require('path').join(__dirname, '../../../static/style/default/index.css'), 'utf8'),

    $: {
        selection: '#selection',
        controls: '#controls',
        output: '#output',
        refresh: '#refresh',
        bake: '#bake',
        status: '#status',
        stats: '#stats',
    },

    methods: {
        async refreshSelection() {
            const selection = await Editor.Message.request(PACKAGE_NAME, 'query-selection') as Array<{ name: string; meshName: string }>;
            (this.$.selection as HTMLElement).textContent = selection.length
                ? selection.map((item) => `${item.name} — ${item.meshName || '(unnamed mesh)'}`).join('\n')
                : 'No selected MeshRenderer.';
        },

        setBusy(busy: boolean, message = '') {
            (this.$.refresh as HTMLButtonElement).disabled = busy;
            (this.$.bake as HTMLButtonElement).disabled = busy;
            (this.$.status as HTMLElement).textContent = message;
        },

        async runBake() {
            this.setBusy(true, 'Baking cage influences and creating GLB assets…');
            try {
                const count = Math.max(2, Math.min(8, Math.floor(numberValue(this.$.controls as HTMLInputElement, 7))));
                const output = (this.$.output as HTMLInputElement).value.trim() || 'db://assets';
                const result = await Editor.Message.request(PACKAGE_NAME, 'bake', count, output) as {
                    assets: Array<{ url: string; vertexCount: number; nodeUuids: string[] }>;
                    assignedCount: number;
                    uniqueAssetCount: number;
                    controlCount: number;
                };
                (this.$.stats as HTMLElement).textContent = result.assets.map((item) =>
                    `${item.url}\nvertices: ${item.vertexCount}\ninstances: ${item.nodeUuids.length}`,
                ).join('\n\n');
                this.setBusy(false, `Assigned ${result.assignedCount} renderer(s) using ${result.uniqueAssetCount} shared baked mesh asset(s).`);
                await this.refreshSelection();
            } catch (error) {
                this.setBusy(false, error instanceof Error ? error.message : String(error));
            }
        },
    },

    async ready() {
        (this.$.refresh as HTMLButtonElement).addEventListener('click', () => void this.refreshSelection());
        (this.$.bake as HTMLButtonElement).addEventListener('click', () => void this.runBake());
        await this.refreshSelection();
    },
});
