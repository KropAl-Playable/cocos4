/*
 Copyright (c) 2026 KropAl-Playable
 SPDX-License-Identifier: MIT
 */

import { BUILD, LOAD_HAVOK_MANUALLY } from 'internal:constants';
import { Game, game } from '../../game';
import { PhysicsSystem } from '../framework/physics-system';
import { selector } from '../framework/physics-selector';
import { HavokWorld } from './havok-world';
import { HavokRigidBody } from './havok-rigid-body';
import {
    HavokBoxShape,
    HavokCapsuleShape,
    HavokSphereShape,
} from './shapes/havok-shape';
import { waitForHavokInstantiation } from './instantiated';

game.once(Game.EVENT_PRE_SUBSYSTEM_INIT, () => {
    selector.register('havok', {
        capabilities: {
            centerOfMass: true,
            gravityScale: true,
            axisLocks: false,
            ccd: false,
            restitution: true,
            materialCombineModes: true,
        },
        PhysicsWorld: HavokWorld,
        RigidBody: HavokRigidBody,
        BoxShape: HavokBoxShape,
        SphereShape: HavokSphereShape,
        CapsuleShape: HavokCapsuleShape,
    });
});

let loadHavokPromise: Promise<void> | undefined;

export function loadWasmModuleHavok (): Promise<void> {
    if (loadHavokPromise) return loadHavokPromise;
    loadHavokPromise = waitForHavokInstantiation();
    if (BUILD && LOAD_HAVOK_MANUALLY) {
        loadHavokPromise = loadHavokPromise.then(() => PhysicsSystem.constructAndRegisterManually());
    }
    return loadHavokPromise;
}
