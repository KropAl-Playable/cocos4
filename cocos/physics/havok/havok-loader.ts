/*
 Copyright (c) 2026 KropAl-Playable
 SPDX-License-Identifier: MIT
 */

import type { HavokModule } from './havok-types';

export type HavokModuleFactory = () => Promise<HavokModule>;

function validateModule (instance: HavokModule): HavokModule {
    if (!instance || typeof instance.HP_World_Create !== 'function') {
        throw new Error('[havok]: initialized module does not expose HP_World_Create.');
    }
    return instance;
}

export class HavokLoader {
    private _instance: HavokModule | undefined;
    private _loadPromise: Promise<HavokModule> | undefined;

    get instance (): HavokModule {
        if (!this._instance) {
            throw new Error('[havok]: Havok wasm module is not initialized. Import physics-havok or call loadWasmModuleHavok() first.');
        }
        return this._instance;
    }

    load (factory: HavokModuleFactory): Promise<HavokModule> {
        if (this._instance) return Promise.resolve(this._instance);
        if (this._loadPromise) return this._loadPromise;

        this._loadPromise = factory()
            .then(validateModule)
            .then((instance) => {
                this._instance = instance;
                return instance;
            })
            .catch((error: unknown) => {
                this._loadPromise = undefined;
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(message.startsWith('[havok]:') ? message : `[havok]: wasm initialization failed: ${message}`);
            });
        return this._loadPromise;
    }
}

export const havokLoader = new HavokLoader();
