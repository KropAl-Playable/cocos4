declare module 'cc/editor/serialization' {
    import type { Mat4, Mesh } from 'cc';

    export type AOVertexColorChannel = 'r' | 'g' | 'b' | 'a' | 'rgb';

    export interface IAOBakeTarget {
        mesh: Mesh;
        worldMatrix?: Mat4;
    }

    export interface IAOBakeOptions {
        sampleCount?: number;
        maxDistance?: number;
        rayBias?: number;
        strength?: number;
        contrast?: number;
        selfOcclusion?: boolean;
        sceneOccluders?: boolean;
        doubleSided?: boolean;
        channel?: AOVertexColorChannel;
    }

    export interface IAOBakeStats {
        vertexCount: number;
        rayCount: number;
        durationMs: number;
        minAO: number;
        averageAO: number;
        maxAO: number;
    }

    export interface IAOBakeResult {
        mesh: Mesh;
        values: Float32Array[];
        stats: IAOBakeStats;
    }

    export function createMeshWithAmbientOcclusionValues(
        source: Mesh,
        values: readonly Float32Array[],
        channel: AOVertexColorChannel,
    ): Mesh;

    export function bakeMeshAmbientOcclusion(
        target: IAOBakeTarget,
        sceneOccluders?: readonly IAOBakeTarget[],
        options?: IAOBakeOptions,
    ): IAOBakeResult;
}
