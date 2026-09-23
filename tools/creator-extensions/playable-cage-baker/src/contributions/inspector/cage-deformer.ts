'use strict';

const PACKAGE_NAME = 'playable-cage-baker';

type Selector<$> = {
    $: Record<keyof $, any | null>;
    dump?: any;
};

export const template = `
<div class="cage-inspector">
    <ui-prop type="dump" class="control-count"></ui-prop>
    <ui-prop type="dump" class="wind-strength"></ui-prop>
    <ui-prop type="dump" class="wind-frequency"></ui-prop>
    <ui-prop type="dump" class="stiffness"></ui-prop>
    <ui-prop type="dump" class="damping"></ui-prop>
    <ui-prop type="dump" class="max-bend-angle"></ui-prop>
    <ui-prop type="dump" class="flutter-strength"></ui-prop>
    <ui-prop type="dump" class="flutter-frequency"></ui-prop>
    <ui-prop type="dump" class="preview-in-editor"></ui-prop>
    <ui-prop type="dump" class="debug-draw"></ui-prop>
    <ui-prop type="dump" class="debug-influences"></ui-prop>
    <ui-prop type="dump" class="debug-control"></ui-prop>

    <ui-prop>
        <ui-label slot="label">Cage Data</ui-label>
        <ui-label slot="content" class="cage-data-status">Checking…</ui-label>
    </ui-prop>

    <div style="display:flex; gap:6px; margin:8px 0 2px;">
        <ui-button class="bake-cage" style="flex:1;">Bake Cage Data</ui-button>
        <ui-button class="refresh-status">Refresh</ui-button>
    </div>

    <div class="cage-note" style="font-size:11px; opacity:.7; line-height:1.4; margin-top:6px;">
        Bake writes persistent cage influences into the Mesh asset. Runtime generation remains a fallback.
    </div>
</div>
`;

export const $ = {
    controlCount: '.control-count',
    windStrength: '.wind-strength',
    windFrequency: '.wind-frequency',
    stiffness: '.stiffness',
    damping: '.damping',
    maxBendAngle: '.max-bend-angle',
    flutterStrength: '.flutter-strength',
    flutterFrequency: '.flutter-frequency',
    previewInEditor: '.preview-in-editor',
    debugDraw: '.debug-draw',
    debugInfluences: '.debug-influences',
    debugControl: '.debug-control',
    status: '.cage-data-status',
    bake: '.bake-cage',
    refresh: '.refresh-status',
};

type PanelThis = Selector<typeof $> & {
    refreshStatus(): Promise<void>;
};

function renderDumpProperty(element: any, property: any): void {
    if (element && property) element.render(property);
}

export function update(this: PanelThis, dump: any): void {
    this.dump = dump;
    const value = dump?.value || {};
    renderDumpProperty(this.$.controlCount, value.controlCount);
    renderDumpProperty(this.$.windStrength, value.windStrength);
    renderDumpProperty(this.$.windFrequency, value.windFrequency);
    renderDumpProperty(this.$.stiffness, value.stiffness);
    renderDumpProperty(this.$.damping, value.damping);
    renderDumpProperty(this.$.maxBendAngle, value.maxBendAngle);
    renderDumpProperty(this.$.flutterStrength, value.flutterStrength);
    renderDumpProperty(this.$.flutterFrequency, value.flutterFrequency);
    renderDumpProperty(this.$.previewInEditor, value.previewInEditor);
    renderDumpProperty(this.$.debugDraw, value.debugDraw);
    renderDumpProperty(this.$.debugInfluences, value.debugInfluences);
    renderDumpProperty(this.$.debugControl, value.debugControl);
    if (this.refreshStatus) void this.refreshStatus();
}

export function ready(this: PanelThis): void {
    this.refreshStatus = async () => {
        try {
            const selection = await Editor.Message.request(PACKAGE_NAME, 'query-selection') as Array<{
                cageData?: 'baked' | 'runtime';
                meshName?: string;
            }>;
            if (!selection.length) {
                this.$.status.textContent = 'No MeshRenderer selected';
                return;
            }
            const modes = new Set(selection.map((item) => item.cageData || 'runtime'));
            const mode = modes.size > 1
                ? 'Mixed'
                : (modes.has('baked') ? 'Baked' : 'Runtime Generated');
            this.$.status.textContent = mode;
        } catch (error) {
            this.$.status.textContent = 'Unavailable';
        }
    };

    this.$.bake.addEventListener('confirm', async () => {
        const count = Number(this.dump?.value?.controlCount?.value ?? 7);
        this.$.bake.disabled = true;
        this.$.status.textContent = 'Baking…';
        try {
            const result = await Editor.Message.request(PACKAGE_NAME, 'bake-current', count) as {
                assignedCount: number;
                uniqueAssetCount: number;
            };
            this.$.status.textContent = `Baked — ${result.assignedCount} renderer(s), ${result.uniqueAssetCount} mesh asset(s)`;
            await this.refreshStatus();
        } catch (error) {
            this.$.status.textContent = error instanceof Error ? error.message : String(error);
        } finally {
            this.$.bake.disabled = false;
        }
    });

    this.$.refresh.addEventListener('confirm', () => void this.refreshStatus());
    void this.refreshStatus();
}
