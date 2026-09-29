/*
 Copyright (c) 2026 KropAl-Playable
 SPDX-License-Identifier: MIT
 */

import type { IQuatLike, IVec3Like } from '../../core';
import type { HavokModule, HavokQuaternion, HavokResult, HavokVector3 } from './havok-types';

export function assertHavokResult (instance: HavokModule, result: HavokResult, operation: string): void {
    const code = havokResultCode(result);
    if (!isHavokResultOk(instance, result)) {
        throw new Error(`[havok]: ${operation} failed with result ${code}.`);
    }
}

export function havokResultCode (result: HavokResult): number { return typeof result === 'number' ? result : result.value; }

export function isHavokResultOk (instance: HavokModule, result: HavokResult): boolean {
    return havokResultCode(result) === havokResultCode(instance.Result.RESULT_OK);
}

export function toHavokVector3 (value: IVec3Like, out: HavokVector3): HavokVector3 {
    out[0] = value.x;
    out[1] = value.y;
    out[2] = value.z;
    return out;
}

export function fromHavokVector3 (value: HavokVector3, out: IVec3Like): IVec3Like {
    out.x = value[0];
    out.y = value[1];
    out.z = value[2];
    return out;
}

export function toHavokQuaternion (value: IQuatLike, out: HavokQuaternion): HavokQuaternion {
    out[0] = value.x;
    out[1] = value.y;
    out[2] = value.z;
    out[3] = value.w;
    return out;
}

export function fromHavokQuaternion (value: HavokQuaternion, out: IQuatLike): IQuatLike {
    out.x = value[0];
    out.y = value[1];
    out.z = value[2];
    out.w = value[3];
    return out;
}
