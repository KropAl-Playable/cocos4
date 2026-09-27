import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import HavokPhysics from '@babylonjs/havok';

const wasmBinary = await readFile(new URL('../../external/emscripten/havok/HavokPhysics.wasm', import.meta.url));
const havok = await HavokPhysics({ wasmBinary });
const ok = havok.Result.RESULT_OK;
const counts = [10, 50, 100, 200];
const results = [];

for (const bodyCount of counts) {
    const [, world] = havok.HP_World_Create();
    assert.equal(havok.HP_World_SetGravity(world, [0, -9.81, 0]), ok);
    assert.equal(havok.HP_World_SetIdealStepTime(world, 1 / 60), ok);
    const [, groundShape] = havok.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], [40, 1, 40]);
    const [, groundBody] = havok.HP_Body_Create();
    havok.HP_Body_SetShape(groundBody, groundShape);
    havok.HP_Body_SetMotionType(groundBody, havok.MotionType.STATIC);
    havok.HP_World_AddBody(world, groundBody, false);
    havok.HP_Body_SetQTransform(groundBody, [[0, -1, 0], [0, 0, 0, 1]]);

    const [, boxShape] = havok.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], [0.8, 0.8, 0.8]);
    const [, baseMass] = havok.HP_Shape_BuildMassProperties(boxShape);
    const bodies = [];
    for (let i = 0; i < bodyCount; i++) {
        const [, body] = havok.HP_Body_Create();
        havok.HP_Body_SetShape(body, boxShape);
        havok.HP_Body_SetMassProperties(body, baseMass);
        havok.HP_Body_SetMotionType(body, havok.MotionType.DYNAMIC);
        havok.HP_World_AddBody(world, body, false);
        const x = (i % 10) * 0.82 - 3.7;
        const y = 1 + Math.floor(i / 10) * 0.82;
        havok.HP_Body_SetQTransform(body, [[x, y, 0], [0, 0, 0, 1]]);
        bodies.push(body);
    }

    for (let i = 0; i < 60; i++) havok.HP_World_Step(world, 1 / 60);
    const stepStart = performance.now();
    for (let i = 0; i < 300; i++) havok.HP_World_Step(world, 1 / 60);
    const stepMilliseconds = (performance.now() - stepStart) / 300;

    const getterStart = performance.now();
    let checksum = 0;
    for (let sample = 0; sample < 300; sample++) {
        for (const body of bodies) checksum += havok.HP_Body_GetQTransform(body)[1][0][1];
    }
    const getterMilliseconds = (performance.now() - getterStart) / 300;

    const [, bodyBuffer] = havok.HP_World_GetBodyBuffer(world);
    const offsets = bodies.map((body) => havok.HP_Body_GetWorldTransformOffset(body)[1]);
    const bufferStart = performance.now();
    for (let sample = 0; sample < 300; sample++) {
        for (const offset of offsets) checksum += havok.HEAPF32[(bodyBuffer + offset + 52) >> 2];
    }
    const bufferMilliseconds = (performance.now() - bufferStart) / 300;
    results.push({
        bodies: bodyCount,
        stepMilliseconds: Number(stepMilliseconds.toFixed(4)),
        getterSyncMilliseconds: Number(getterMilliseconds.toFixed(4)),
        bufferSyncMilliseconds: Number(bufferMilliseconds.toFixed(4)),
        syncSpeedup: Number((getterMilliseconds / Math.max(Number.EPSILON, bufferMilliseconds)).toFixed(1)),
        wasmMemoryMiB: Number((havok.HEAPU8.byteLength / 1048576).toFixed(1)),
    });
    if (!Number.isFinite(checksum)) throw new Error('benchmark checksum is invalid');

    for (const body of bodies) {
        havok.HP_World_RemoveBody(world, body);
        havok.HP_Body_Release(body);
    }
    havok.HP_World_RemoveBody(world, groundBody);
    havok.HP_Body_Release(groundBody);
    havok.HP_Shape_Release(boxShape);
    havok.HP_Shape_Release(groundShape);
    havok.HP_World_Release(world);
}

console.log(JSON.stringify({ platform: `${process.platform}-${process.arch}`, node: process.version, results }, null, 2));
