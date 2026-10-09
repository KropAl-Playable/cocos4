/*
 Copyright (c) 2026 KropAl-Playable
 SPDX-License-Identifier: MIT
 */

type Handle = readonly [bigint];

export class HavokHandleRegistry<TOwner extends object, THandle extends Handle, TValue> {
    private readonly _ownerToHandle = new Map<TOwner, THandle>();
    private readonly _handleToValue = new Map<bigint, TValue>();

    get size (): number {
        return this._ownerToHandle.size;
    }

    hasOwner (owner: TOwner): boolean {
        return this._ownerToHandle.has(owner);
    }

    register (owner: TOwner, handle: THandle, value: TValue): void {
        const key = handle[0];
        if (this._ownerToHandle.has(owner)) {
            throw new Error('[havok]: owner is already registered.');
        }
        if (this._handleToValue.has(key)) {
            throw new Error('[havok]: handle is already registered.');
        }
        this._ownerToHandle.set(owner, handle);
        this._handleToValue.set(key, value);
    }

    getHandle (owner: TOwner): THandle | undefined {
        return this._ownerToHandle.get(owner);
    }

    getValue (handle: THandle): TValue | undefined {
        return this._handleToValue.get(handle[0]);
    }

    unregisterOwner (owner: TOwner): THandle | undefined {
        const handle = this._ownerToHandle.get(owner);
        if (!handle) return undefined;
        this._ownerToHandle.delete(owner);
        this._handleToValue.delete(handle[0]);
        return handle;
    }

    clear (): void {
        this._ownerToHandle.clear();
        this._handleToValue.clear();
    }
}
