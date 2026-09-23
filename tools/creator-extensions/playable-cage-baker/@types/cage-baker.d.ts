declare module 'cc/editor/serialization' {
    import type { Mesh } from 'cc';

    export const MAX_CAGE_CONTROLS: number;
    export function createCageInfluenceMesh(source: Mesh, controlCount: number): Mesh;
    export function hasCageInfluenceData(mesh: Mesh): boolean;
}
