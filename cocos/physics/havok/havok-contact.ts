/*
 Copyright (c) 2026 KropAl-Playable
 SPDX-License-Identifier: MIT
 */

import { IVec3Like, Quat, Vec3 } from '../../core';
import type { Collider, ICollisionEvent, IContactEquation } from '../framework';
import type { HavokCollisionEvent, HavokContactPoint } from './havok-types';

export class HavokContact implements IContactEquation {
    impl: HavokCollisionEvent | null = null;
    event!: ICollisionEvent;
    shapeA!: Collider;
    shapeB!: Collider;
    private readonly _inverse = new Quat();

    get isBodyA (): boolean { return this.event.selfCollider === this.shapeA; }

    getLocalPointOnA (out: IVec3Like): void { this._localPoint(out, this._contactA(), this.shapeA); }
    getLocalPointOnB (out: IVec3Like): void { this._localPoint(out, this._contactB(), this.shapeB); }
    getWorldPointOnA (out: IVec3Like): void { this._copy(out, this._contactA()[3]); }
    getWorldPointOnB (out: IVec3Like): void { this._copy(out, this._contactB()[3]); }
    getLocalNormalOnA (out: IVec3Like): void { this._localNormal(out, this._contactA(), this.shapeA); }
    getLocalNormalOnB (out: IVec3Like): void { this._localNormal(out, this._contactB(), this.shapeB); }
    getWorldNormalOnA (out: IVec3Like): void { this._copy(out, this._contactA()[4]); }
    getWorldNormalOnB (out: IVec3Like): void { this._copy(out, this._contactB()[4]); }

    private _contactA (): HavokContactPoint { return this.impl![1]; }
    private _contactB (): HavokContactPoint { return this.impl![2]; }
    private _copy (out: IVec3Like, value: [number, number, number]): void { out.x = value[0]; out.y = value[1]; out.z = value[2]; }
    private _localPoint (out: IVec3Like, contact: HavokContactPoint, collider: Collider): void {
        this._copy(out, contact[3]);
        Vec3.transformInverseRTS(out, out, collider.node.worldRotation, collider.node.worldPosition, collider.node.worldScale);
    }
    private _localNormal (out: IVec3Like, contact: HavokContactPoint, collider: Collider): void {
        this._copy(out, contact[4]);
        Quat.conjugate(this._inverse, collider.node.worldRotation);
        Vec3.transformQuat(out, out, this._inverse);
    }
}
