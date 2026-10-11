/*
 * Explicit feature entry for AnimationGraph/AnimationController.
 *
 * Unlike the re-export in cocos/animation/animation.ts, this entry cannot be
 * replaced by the MARIONETTE=false module override. Selecting the Marionette
 * feature therefore always brings its class registrations into the bundle.
 * The module is not selected for projects that crop Marionette out.
 */

import '../cocos/animation/marionette/animation-graph';
import '../cocos/animation/marionette/motion';
import '../cocos/animation/marionette/animation-mask';
import '../cocos/animation/marionette/animation-graph-variant';
import '../cocos/animation/marionette/pose-graph/pose-nodes/all';
import '../cocos/animation/marionette/pose-graph/pure-value-nodes/all';

export { AnimationController } from '../cocos/animation/marionette/animation-controller';
export { StateMachineComponent } from '../cocos/animation/marionette/state-machine/state-machine-component';
export { VariableType } from '../cocos/animation/marionette/parametric';
