import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';

const wasmUrl = new URL('../../external/emscripten/havok/HavokPhysics.wasm', import.meta.url);
const wasmBinary = await readFile(wasmUrl);
const havok = await HavokPhysics({ wasmBinary });
const [createResult, world] = havok.HP_World_Create();

assert.equal(createResult, havok.Result.RESULT_OK);
assert.equal(havok.HP_World_SetGravity(world, [0, -9.81, 0]), havok.Result.RESULT_OK);
assert.equal(havok.HP_World_SetIdealStepTime(world, 1 / 60), havok.Result.RESULT_OK);

const ok = havok.Result.RESULT_OK;
const resultValue = (result) => typeof result === 'number' ? result : result.value;
const assertOk = (result) => assert.equal(resultValue(result), resultValue(ok));
const [groundShapeResult, groundShape] = havok.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], [20, 1, 20]);
assert.equal(groundShapeResult, ok);
assert.equal(havok.HP_Shape_SetFilterInfo(groundShape, [1, 1]), ok);
const [groundBodyResult, groundBody] = havok.HP_Body_Create();
assert.equal(groundBodyResult, ok);
assert.equal(havok.HP_Body_SetShape(groundBody, groundShape), ok);
assert.equal(havok.HP_Body_SetQTransform(groundBody, [[0, -1, 0], [0, 0, 0, 1]]), ok);
assert.equal(havok.HP_Body_SetMotionType(groundBody, havok.MotionType.STATIC), ok);
assert.equal(havok.HP_Body_SetEventMask(groundBody, 0x1f), ok);
assert.equal(havok.HP_World_AddBody(world, groundBody, false), ok);

const [containerResult, container] = havok.HP_Shape_CreateContainer();
assert.equal(containerResult, ok);
const [boxResult, box] = havok.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
const [sphereResult, sphere] = havok.HP_Shape_CreateSphere([0, 0, 0], 0.35);
const [capsuleResult, capsule] = havok.HP_Shape_CreateCapsule([0, -0.5, 0], [0, 0.5, 0], 0.25);
const [cylinderResult, cylinder] = havok.HP_Shape_CreateCylinder([0, -0.5, 0], [0, 0.5, 0], 0.25);
assert.equal(boxResult, ok);
assert.equal(sphereResult, ok);
assert.equal(havok.HP_Shape_SetFilterInfo(box, [1, 1]), ok);
assert.equal(havok.HP_Shape_SetFilterInfo(sphere, [1, 1]), ok);
assert.equal(capsuleResult, ok);
assert.equal(cylinderResult, ok);

const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
const vertexPtr = havok._malloc(vertices.byteLength);
havok.HEAPF32.set(vertices, vertexPtr >> 2);
const [hullResult, hull] = havok.HP_Shape_CreateConvexHull(vertexPtr, 4);
assert.equal(hullResult, ok);
const triangles = new Uint32Array([0, 1, 2, 0, 3, 1]);
const trianglePtr = havok._malloc(triangles.byteLength);
havok.HEAPU32.set(triangles, trianglePtr >> 2);
const [meshResult, mesh] = havok.HP_Shape_CreateMesh(vertexPtr, 4, trianglePtr, 2);
assert.equal(meshResult, ok);
havok._free(trianglePtr);
havok._free(vertexPtr);
assert.equal(havok.HP_Shape_AddChild(container, box, [[0, 0, 0], [0, 0, 0, 1], [1, 1, 1]]), ok);
assert.equal(havok.HP_Shape_AddChild(container, sphere, [[0.75, 0, 0], [0, 0, 0, 1], [1, 1, 1]]), ok);
const [massResult, massProperties] = havok.HP_Shape_BuildMassProperties(container);
assert.equal(massResult, ok);
massProperties[1] = 2;

const [bodyResult, body] = havok.HP_Body_Create();
assert.equal(bodyResult, ok);
assert.equal(havok.HP_Body_SetShape(body, container), ok);
assert.equal(havok.HP_Body_SetMassProperties(body, massProperties), ok);
assert.equal(havok.HP_Body_SetMotionType(body, havok.MotionType.DYNAMIC), ok);
assert.equal(havok.HP_Body_SetEventMask(body, 0x1f), ok);
assert.equal(havok.HP_Body_SetQTransform(body, [[0, 4, 0], [0, 0, 0, 1]]), ok);
assert.equal(havok.HP_World_AddBody(world, body, false), ok);
assert.equal(havok.HP_Body_ApplyImpulse(body, [0, 4, 0], [1, 0, 0]), ok);

let sawCollision = false;
for (let i = 0; i < 120; i++) {
    assert.equal(havok.HP_World_Step(world, 1 / 60), ok);
    const [stepEventResult, stepEventId] = havok.HP_World_GetCollisionEvents(world);
    if (resultValue(stepEventResult) === resultValue(ok) && stepEventId) {
        const [collisionResult, collision] = havok.HP_Event_AsCollision(stepEventId);
        assertOk(collisionResult);
        assert.ok(collision[1][1][0] || collision[1][2][0] || collision[2][1][0] || collision[2][2][0], 'expected shape path in collision event');
        sawCollision = true;
    }
}
assert.ok(sawCollision, 'expected collision events');
const [transformResult, transform] = havok.HP_Body_GetQTransform(body);
assert.equal(transformResult, ok);
assert.ok(transform[0][1] > -0.1 && transform[0][1] < 2, `unexpected body height ${transform[0][1]}`);
const [bufferResult, bodyBuffer] = havok.HP_World_GetBodyBuffer(world);
const [offsetResult, transformOffset] = havok.HP_Body_GetWorldTransformOffset(body);
assertOk(bufferResult);
assertOk(offsetResult);
const matrixStart = (bodyBuffer + transformOffset) >> 2;
assert.ok(Math.abs(havok.HEAPF32[matrixStart + 12] - transform[0][0]) < 1e-5);
assert.ok(Math.abs(havok.HEAPF32[matrixStart + 13] - transform[0][1]) < 1e-5);
assert.ok(Math.abs(havok.HEAPF32[matrixStart + 14] - transform[0][2]) < 1e-5);

const [collectorResult, collector] = havok.HP_QueryCollector_Create(32);
assertOk(collectorResult);
assert.equal(havok.HP_World_CastRayWithCollector(world, collector, [[0, 10, 0], [0, -10, 0], [0xffffffff, 0xffffffff], false, [0n]]), ok);
const [rayCountResult, rayCount] = havok.HP_QueryCollector_GetNumHits(collector);
assertOk(rayCountResult);
assert.ok(rayCount >= 1, 'expected raycast hit');
const [rayResult] = havok.HP_QueryCollector_GetCastRayResult(collector, 0);
assertOk(rayResult);
assert.equal(havok.HP_World_CastRayWithCollector(world, collector, [[0, 10, 0], [0, -10, 0], [2, 2], false, [0n]]), ok);
const [filteredCountResult, filteredCount] = havok.HP_QueryCollector_GetNumHits(collector);
assertOk(filteredCountResult);
assert.equal(filteredCount, 0, 'collision filtering should exclude the ray');

const [querySphereResult, querySphere] = havok.HP_Shape_CreateSphere([0, 0, 0], 0.25);
assert.equal(querySphereResult, ok);
assert.equal(havok.HP_Shape_SetFilterInfo(querySphere, [0xffffffff, 0xffffffff]), ok);
assert.equal(havok.HP_World_ShapeCastWithCollector(world, collector, [querySphere, [0, 0, 0, 1], [2, 5, 0], [2, -2, 0], false, [0n]]), ok);
const [castCountResult, castCount] = havok.HP_QueryCollector_GetNumHits(collector);
assertOk(castCountResult);
assert.ok(castCount >= 1, 'expected sphere cast hit');
assert.equal(havok.HP_World_ShapeProximityWithCollector(world, collector, [querySphere, transform[0], [0, 0, 0, 1], 0.5, false, [0n]]), ok);
const [proximityCountResult, proximityCount] = havok.HP_QueryCollector_GetNumHits(collector);
assertOk(proximityCountResult);
assert.ok(proximityCount >= 1, 'expected shape proximity hit');
assert.equal(havok.HP_Shape_Release(querySphere), ok);
assert.equal(havok.HP_QueryCollector_Release(collector), ok);

const [constraintResult, constraint] = havok.HP_Constraint_Create();
assertOk(constraintResult);
assert.equal(havok.HP_Constraint_SetParentBody(constraint, body), ok);
assert.equal(havok.HP_Constraint_SetChildBody(constraint, [0n]), ok);
assert.equal(havok.HP_Constraint_SetAnchorInParent(constraint, [0, 0, 0], [1, 0, 0], [0, 1, 0]), ok);
assert.equal(havok.HP_Constraint_SetAnchorInChild(constraint, transform[0], [1, 0, 0], [0, 1, 0]), ok);
for (let axis = 0; axis < 3; axis++) assert.equal(havok.HP_Constraint_SetAxisMode(constraint, axis, havok.ConstraintAxisLimitMode.LOCKED), ok);
for (let axis = 3; axis < 6; axis++) assert.equal(havok.HP_Constraint_SetAxisMode(constraint, axis, havok.ConstraintAxisLimitMode.FREE), ok);
assert.equal(havok.HP_Constraint_SetAxisMotorType(constraint, 0, havok.ConstraintMotorType.NONE), ok);
assert.notEqual(
    resultValue(havok.HP_Constraint_SetAxisMotorPositionTarget(constraint, 0, 0)),
    resultValue(ok),
    'Havok rejects position targets while the axis motor is disabled',
);
assert.equal(havok.HP_Constraint_SetAxisMotorType(constraint, 0, havok.ConstraintMotorType.POSITION), ok);
assert.equal(havok.HP_Constraint_SetAxisMotorPositionTarget(constraint, 0, 0), ok);
assert.equal(havok.HP_Constraint_SetAxisMotorMaxForce(constraint, 0, 10), ok);
assert.equal(havok.HP_Constraint_SetAxisMotorType(constraint, 1, havok.ConstraintMotorType.VELOCITY), ok);
assert.equal(havok.HP_Constraint_SetAxisMotorVelocityTarget(constraint, 1, 0), ok);
assert.equal(havok.HP_Constraint_SetAxisMotorMaxForce(constraint, 1, 10), ok);
assert.equal(havok.HP_Constraint_SetEnabled(constraint, 1), ok);
assert.equal(havok.HP_World_Step(world, 1 / 60), ok);
assert.equal(havok.HP_Constraint_SetEnabled(constraint, 0), ok);
assert.equal(havok.HP_Constraint_Release(constraint), ok);

assert.equal(havok.HP_World_RemoveBody(world, body), ok);
assert.equal(havok.HP_World_RemoveBody(world, groundBody), ok);
assert.equal(havok.HP_Body_Release(body), ok);
assert.equal(havok.HP_Body_Release(groundBody), ok);
assert.equal(havok.HP_Shape_RemoveChild(container, 1), ok);
assert.equal(havok.HP_Shape_RemoveChild(container, 0), ok);
assert.equal(havok.HP_Shape_Release(sphere), ok);
assert.equal(havok.HP_Shape_Release(box), ok);
assert.equal(havok.HP_Shape_Release(capsule), ok);
assert.equal(havok.HP_Shape_Release(cylinder), ok);
assert.equal(havok.HP_Shape_Release(hull), ok);
assert.equal(havok.HP_Shape_Release(mesh), ok);
assert.equal(havok.HP_Shape_Release(container), ok);
assert.equal(havok.HP_Shape_Release(groundShape), ok);
assert.equal(havok.HP_World_Release(world), havok.Result.RESULT_OK);
const [reloadResult, reloadWorld] = havok.HP_World_Create();
assertOk(reloadResult);
assert.equal(havok.HP_World_Release(reloadWorld), ok);

console.log('[havok]: rigid-body, compound-shape, constraint-motor, impulse, and collision wasm smoke passed.');
