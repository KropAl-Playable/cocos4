/*
 Copyright (c) 2026 KropAl-Playable
 SPDX-License-Identifier: MIT
 */

import { waitForHavokInstantiation } from './instantiated';

let loadHavokPromise: Promise<void> | undefined;

/**
 * Loads the standalone Havok Web runtime.
 *
 * Task 004 ports the runtime vertical slice before registering a Cocos physics
 * wrapper. Selector registration will be added together with HavokWorld/body/
 * primitive-shape wrappers so selecting the backend can never produce a
 * half-registered physics system.
 */
export function loadWasmModuleHavok (): Promise<void> {
    if (loadHavokPromise) return loadHavokPromise;
    loadHavokPromise = waitForHavokInstantiation();
    return loadHavokPromise;
}
