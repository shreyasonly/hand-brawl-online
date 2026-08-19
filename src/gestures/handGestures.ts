import fp from 'fingerpose';
import { Gesture } from './GestureConfig';

const { Finger, FingerCurl, FingerDirection, GestureDescription } = fp;

/**
 * Fingerpose gesture descriptions, written in the same style as the reference
 * project https://github.com/chaitanya-chafale/Hand-Gesture-Gaming (see its
 * src/left.js, src/right.js, src/start.js ...): every finger contributes an
 * expected curl and an expected pointing direction with a confidence weight,
 * and the estimator scores the live hand against each description (0 - 10).
 *
 * Directions are declared permissively (both diagonals, both horizontals where
 * they do not disambiguate) so the same descriptions work for a left hand, a
 * right hand and the horizontally mirrored preview.
 */

/** FIST - PUNCH */
const fistGesture = new GestureDescription(Gesture.FIST);
fistGesture.addCurl(Finger.Thumb, FingerCurl.HalfCurl, 1.0);
fistGesture.addCurl(Finger.Thumb, FingerCurl.FullCurl, 1.0);
fistGesture.addDirection(Finger.Thumb, FingerDirection.HorizontalLeft, 0.5);
fistGesture.addDirection(Finger.Thumb, FingerDirection.HorizontalRight, 0.5);
fistGesture.addDirection(Finger.Thumb, FingerDirection.DiagonalUpLeft, 0.5);
fistGesture.addDirection(Finger.Thumb, FingerDirection.DiagonalUpRight, 0.5);
for (const finger of [Finger.Index, Finger.Middle, Finger.Ring, Finger.Pinky]) {
  fistGesture.addCurl(finger, FingerCurl.FullCurl, 1.0);
  // A real fist often reads as HalfCurl on one or two fingers, so accept it
  // with a strong weight instead of losing the pose entirely.
  fistGesture.addCurl(finger, FingerCurl.HalfCurl, 0.8);
}

/** OPEN PALM - BLOCK */
const openPalmGesture = new GestureDescription(Gesture.OPEN_PALM);
openPalmGesture.addCurl(Finger.Thumb, FingerCurl.NoCurl, 1.0);
openPalmGesture.addCurl(Finger.Thumb, FingerCurl.HalfCurl, 0.6);
for (const finger of [Finger.Index, Finger.Middle, Finger.Ring, Finger.Pinky]) {
  openPalmGesture.addCurl(finger, FingerCurl.NoCurl, 1.0);
  openPalmGesture.addDirection(finger, FingerDirection.VerticalUp, 1.0);
  openPalmGesture.addDirection(finger, FingerDirection.DiagonalUpLeft, 0.85);
  openPalmGesture.addDirection(finger, FingerDirection.DiagonalUpRight, 0.85);
}

/** VICTORY / TWO FINGERS - KICK */
const victoryGesture = new GestureDescription(Gesture.VICTORY);
victoryGesture.addCurl(Finger.Thumb, FingerCurl.HalfCurl, 0.75);
victoryGesture.addCurl(Finger.Thumb, FingerCurl.FullCurl, 0.75);
for (const finger of [Finger.Index, Finger.Middle]) {
  victoryGesture.addCurl(finger, FingerCurl.NoCurl, 1.0);
  victoryGesture.addDirection(finger, FingerDirection.VerticalUp, 1.0);
  victoryGesture.addDirection(finger, FingerDirection.DiagonalUpLeft, 0.9);
  victoryGesture.addDirection(finger, FingerDirection.DiagonalUpRight, 0.9);
}
for (const finger of [Finger.Ring, Finger.Pinky]) {
  victoryGesture.addCurl(finger, FingerCurl.FullCurl, 1.0);
  victoryGesture.addCurl(finger, FingerCurl.HalfCurl, 0.6);
}

/** INDEX FINGER - SPECIAL */
const indexGesture = new GestureDescription(Gesture.INDEX);
indexGesture.addCurl(Finger.Thumb, FingerCurl.HalfCurl, 0.6);
indexGesture.addCurl(Finger.Thumb, FingerCurl.FullCurl, 0.6);
indexGesture.addCurl(Finger.Index, FingerCurl.NoCurl, 1.0);
indexGesture.addDirection(Finger.Index, FingerDirection.VerticalUp, 1.0);
indexGesture.addDirection(Finger.Index, FingerDirection.DiagonalUpLeft, 0.9);
indexGesture.addDirection(Finger.Index, FingerDirection.DiagonalUpRight, 0.9);
for (const finger of [Finger.Middle, Finger.Ring, Finger.Pinky]) {
  indexGesture.addCurl(finger, FingerCurl.FullCurl, 1.0);
  indexGesture.addCurl(finger, FingerCurl.HalfCurl, 0.65);
}

/** THUMBS UP - ULTIMATE */
const thumbsUpGesture = new GestureDescription(Gesture.THUMBS_UP);
thumbsUpGesture.addCurl(Finger.Thumb, FingerCurl.NoCurl, 1.0);
thumbsUpGesture.addDirection(Finger.Thumb, FingerDirection.VerticalUp, 1.0);
thumbsUpGesture.addDirection(Finger.Thumb, FingerDirection.DiagonalUpLeft, 0.9);
thumbsUpGesture.addDirection(Finger.Thumb, FingerDirection.DiagonalUpRight, 0.9);
for (const finger of [Finger.Index, Finger.Middle, Finger.Ring, Finger.Pinky]) {
  thumbsUpGesture.addCurl(finger, FingerCurl.FullCurl, 1.0);
  thumbsUpGesture.addCurl(finger, FingerCurl.HalfCurl, 0.7);
  thumbsUpGesture.addDirection(finger, FingerDirection.HorizontalLeft, 0.6);
  thumbsUpGesture.addDirection(finger, FingerDirection.HorizontalRight, 0.6);
  thumbsUpGesture.addDirection(finger, FingerDirection.DiagonalUpLeft, 0.5);
  thumbsUpGesture.addDirection(finger, FingerDirection.DiagonalUpRight, 0.5);
}

/**
 * PINCH is deliberately NOT a fingerpose description: curl/direction cannot
 * express "thumb tip is touching index tip". It is detected geometrically in
 * GestureRecognizer instead.
 */
export const KNOWN_GESTURES = [
  fistGesture,
  openPalmGesture,
  victoryGesture,
  indexGesture,
  thumbsUpGesture
];
