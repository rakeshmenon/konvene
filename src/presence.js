// "Stepped away": is anyone in front of the camera?
//
// A face facing the camera is the quickest sign, but people turn to a second screen, look down at
// notes or sit against a bright window, and the face tracker loses them while they're right there.
// So three things count as "here":
//   - a face (checked every frame),
//   - a person in the picture, from the background-cutout model (checked about once a second, and
//     only once the face has been missing for a couple of seconds),
//   - your voice on the microphone.
// Only when none of them has been seen for AWAY_MS does your video pause. Coming back needs a face
// for a moment, or a person in two checks in a row (a voice alone could be a TV in an empty room).

export const AWAY_MS = 30000;
const BACK_FACE_MS = 600;
const BACK_PERSON_CHECKS = 2;
const CHECK_AFTER_MS = 2000; // face missing this long: start looking for a person instead
const CHECK_EVERY_MS = 1000;

// share of the picture that must be confidently "person"
export const PERSON_SHARE = 0.05;

// mask: Float32Array of 0..1 person confidence; sure: the confidence that counts
export function personShare(mask, sure) {
  if (!mask || !mask.length) return 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] >= sure) n++;
  return n / mask.length;
}

export class Presence {
  constructor() { this.reset(0); }

  reset(now) {
    this.away = false;
    this.seenAt = now; // last time anything said "here"
    this.faceAt = now; // last time a face was seen
    this.faceSince = 0; // start of the current run of face frames
    this.personRun = 0; // person checks in a row that found someone
    this.checkedAt = 0;
  }

  // should the next frame look for a person (the cutout model)?
  wantsPersonCheck(now) {
    return now - this.faceAt > CHECK_AFTER_MS && now - this.checkedAt >= CHECK_EVERY_MS;
  }

  // now: ms. face: a face this frame. person: true/false when a person check ran, otherwise null.
  // voice: the microphone heard speech. Returns whether you're away.
  update(now, { face = false, person = null, voice = false } = {}) {
    if (!this.seenAt) this.seenAt = now;
    if (person !== null) {
      this.checkedAt = now;
      this.personRun = person ? this.personRun + 1 : 0;
    }
    if (face) {
      this.faceAt = now;
      if (!this.faceSince) this.faceSince = now;
    } else this.faceSince = 0;

    if (face || person === true || voice) this.seenAt = now;

    if (this.away) {
      const faceBack = face && now - this.faceSince >= BACK_FACE_MS;
      const personBack = this.personRun >= BACK_PERSON_CHECKS;
      if (faceBack || personBack) { this.away = false; this.seenAt = now; }
    } else if (now - this.seenAt > AWAY_MS) {
      this.away = true;
    }
    return this.away;
  }
}
