/*
 Copyright (c) 2026 KropAl-Playable
 SPDX-License-Identifier: MIT
 */

import { BUILD, LOAD_HAVOK_MANUALLY } from 'internal:constants';
import { ensureWasmModuleReady, instantiateWasm } from 'pal/wasm';
import { error, log } from '../../core';
import { game } from '../../game';
import { havokLoader } from './havok-loader';
import type { HavokEmscriptenFactory, HavokModule } from './havok-types';

function instantiateHavok (factory: HavokEmscriptenFactory, wasmUrl: string): Promise<HavokModule> {
    return new Promise((resolve, reject) => {
        factory({
            instantiateWasm (
                importObject: WebAssembly.Imports,
                receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
            ) {
                instantiateWasm(wasmUrl, importObject).then((result) => {
                    receiveInstance(result.instance, result.module);
                }).catch(reject);
                return {};
            },
        }).then(resolve).catch(reject);
    });
}

export function waitForHavokInstantiation (): Promise<void> {
    return havokLoader.load(() => ensureWasmModuleReady()
        .then(() => Promise.all([
            import('../../../external/emscripten/havok/HavokPhysics_es.js'),
            import('external:emscripten/havok/HavokPhysics.wasm'),
        ]))
        .then(([{ default: factory }, { default: wasmUrl }]) => instantiateHavok(
            factory as unknown as HavokEmscriptenFactory,
            wasmUrl,
        ))
        .then((instance) => {
            log('[havok]: Havok wasm lib loaded.');
            return instance;
        })
        .catch((err: unknown) => {
            error(`[havok]: ${String(err)}`);
            throw err;
        }))
        .then(() => undefined);
}

if (!BUILD || !LOAD_HAVOK_MANUALLY) {
    game.onPostInfrastructureInitDelegate.add(waitForHavokInstantiation);
}
