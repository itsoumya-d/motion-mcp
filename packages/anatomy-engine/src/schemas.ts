import type { SpeciesSchema } from "./types.js";

export const HUMAN_BIPED: SpeciesSchema = {
  id: "human-biped",
  label: "Human Biped",
  expected: { head: 1, eyes: 2, mouth: 1, body: 1, arm: 2, leg: 2 },
  actions: {
    blink: {
      description: "Both eyelids close briefly via vertical squash.",
      steps: [
        { role: "eyes", controller: "scaleY", amount: 0.12, durationMs: 110, holdMs: 50, easing: "easeOut" },
        { role: "eyes", controller: "scaleY", amount: 1, durationMs: 130, easing: "easeInOut" }
      ]
    },
    wave: {
      description: "Right arm raises from the shoulder and settles.",
      steps: [
        { role: "arm", controller: "rotate", amount: -28, durationMs: 260, easing: "spring" },
        { role: "arm", controller: "rotate", amount: -18, durationMs: 220, easing: "easeInOut" },
        { role: "arm", controller: "rotate", amount: 0, durationMs: 300, easing: "easeInOut" }
      ]
    },
    breathe: {
      description: "Chest lifts and settles for an idle loop.",
      steps: [
        { role: "body", controller: "translateY", amount: -1.5, durationMs: 1400, easing: "easeInOut" },
        { role: "body", controller: "translateY", amount: 0, durationMs: 1600, easing: "easeInOut" }
      ]
    },
    nod: {
      description: "Head affirmation dip.",
      steps: [
        { role: "head", controller: "rotate", amount: 9, durationMs: 190, easing: "easeOut" },
        { role: "head", controller: "rotate", amount: -4, durationMs: 210, easing: "easeInOut" },
        { role: "head", controller: "rotate", amount: 0, durationMs: 180, easing: "easeInOut" }
      ]
    },
    squat: {
      description: "Legs compress and return; exercise rep primitive.",
      steps: [
        { role: "leg", controller: "translateY", amount: 7, durationMs: 340, easing: "easeInOut" },
        { role: "leg", controller: "translateY", amount: 0, durationMs: 380, easing: "spring" }
      ]
    }
  }
};

export const AVIAN_CROW: SpeciesSchema = {
  id: "avian-crow",
  label: "Avian Crow",
  expected: { head: 1, eyes: 2, mouth: 1, wing: 2, tail: 1, leg: 2, body: 1 },
  actions: {
    blink: {
      description: "Nictating membrane sweep approximated by eyelid squash.",
      steps: [
        { role: "eyes", controller: "scaleY", amount: 0.15, durationMs: 100, holdMs: 40, easing: "easeOut" },
        { role: "eyes", controller: "scaleY", amount: 1, durationMs: 120, easing: "easeInOut" }
      ]
    },
    flap: {
      description: "Wings beat down then recover.",
      steps: [
        { role: "wing", controller: "rotate", amount: -34, durationMs: 240, easing: "easeOut" },
        { role: "wing", controller: "rotate", amount: 16, durationMs: 240, easing: "easeInOut" },
        { role: "wing", controller: "rotate", amount: 0, durationMs: 200, easing: "easeInOut" }
      ]
    },
    wave: {
      description: "No arms: wing lift plus head bob replaces the human wave.",
      steps: [
        { role: "wing", controller: "rotate", amount: -26, durationMs: 280, easing: "spring", note: "wing lift replaces arm raise" },
        { role: "head", controller: "rotate", amount: -6, durationMs: 280, easing: "easeInOut" },
        { role: "wing", controller: "rotate", amount: 0, durationMs: 260, easing: "easeInOut" },
        { role: "head", controller: "rotate", amount: 0, durationMs: 240, easing: "easeInOut" }
      ]
    },
    caw: {
      description: "Beak opens wide then closes with a snap.",
      steps: [
        { role: "mouth", controller: "scaleY", amount: 1.45, durationMs: 150, holdMs: 70, easing: "easeOut" },
        { role: "mouth", controller: "scaleY", amount: 1, durationMs: 120, easing: "easeIn" }
      ]
    },
    peck: {
      description: "Head dips forward toward the ground and recovers.",
      steps: [
        { role: "head", controller: "translateY", amount: 7, durationMs: 170, easing: "easeIn" },
        { role: "head", controller: "translateY", amount: 0, durationMs: 230, easing: "easeOut" }
      ]
    },
    hop: {
      description: "Both legs push off together; crow locomotion primitive.",
      steps: [
        { role: "leg", controller: "translateY", amount: -5, durationMs: 180, easing: "easeOut" },
        { role: "leg", controller: "translateY", amount: 0, durationMs: 220, easing: "easeIn" }
      ]
    },
    tailFlick: {
      description: "Tail feathers flick up for balance emphasis.",
      steps: [
        { role: "tail", controller: "rotate", amount: 12, durationMs: 160, easing: "easeOut" },
        { role: "tail", controller: "rotate", amount: 0, durationMs: 220, easing: "easeInOut" }
      ]
    }
  }
};

export const GENERIC_QUADRUPED: SpeciesSchema = {
  id: "generic-quadruped",
  label: "Generic Quadruped",
  expected: { head: 1, eyes: 2, mouth: 1, body: 1, leg: 4, tail: 1 },
  actions: {
    blink: {
      description: "Both eyes close briefly via vertical squash.",
      steps: [
        { role: "eyes", controller: "scaleY", amount: 0.14, durationMs: 110, holdMs: 50, easing: "easeOut" },
        { role: "eyes", controller: "scaleY", amount: 1, durationMs: 130, easing: "easeInOut" }
      ]
    },
    trot: {
      description: "Legs alternate in a light two-beat trot.",
      steps: [
        { role: "leg", controller: "translateY", amount: -4, durationMs: 200, easing: "easeInOut" },
        { role: "leg", controller: "translateY", amount: 0, durationMs: 200, easing: "easeInOut" },
        { role: "leg", controller: "translateY", amount: -4, durationMs: 200, easing: "easeInOut" },
        { role: "leg", controller: "translateY", amount: 0, durationMs: 220, easing: "spring" }
      ]
    },
    tailWag: {
      description: "Tail sweeps side to side for greeting.",
      steps: [
        { role: "tail", controller: "rotate", amount: 16, durationMs: 220, easing: "easeInOut" },
        { role: "tail", controller: "rotate", amount: -16, durationMs: 260, easing: "easeInOut" },
        { role: "tail", controller: "rotate", amount: 0, durationMs: 220, easing: "easeInOut" }
      ]
    },
    sit: {
      description: "Haunches compress into a sit and hold.",
      steps: [
        { role: "body", controller: "translateY", amount: 6, durationMs: 320, easing: "easeInOut" },
        { role: "leg", controller: "translateY", amount: 3, durationMs: 320, easing: "easeInOut" }
      ]
    },
    breathe: {
      description: "Chest lifts and settles for an idle loop.",
      steps: [
        { role: "body", controller: "translateY", amount: -1.5, durationMs: 1400, easing: "easeInOut" },
        { role: "body", controller: "translateY", amount: 0, durationMs: 1600, easing: "easeInOut" }
      ]
    }
  }
};

export const INSECT: SpeciesSchema = {
  id: "insect",
  label: "Insect",
  expected: { head: 1, eyes: 2, body: 1, wing: 2, leg: 4 },
  actions: {
    blink: {
      description: "Compound-eye shimmer approximated by a quick squash.",
      steps: [
        { role: "eyes", controller: "scaleY", amount: 0.2, durationMs: 90, holdMs: 40, easing: "easeOut" },
        { role: "eyes", controller: "scaleY", amount: 1, durationMs: 110, easing: "easeInOut" }
      ]
    },
    buzz: {
      description: "Wings blur in a fast figure-eight flutter.",
      steps: [
        { role: "wing", controller: "rotate", amount: -18, durationMs: 70, easing: "linear" },
        { role: "wing", controller: "rotate", amount: 18, durationMs: 70, easing: "linear" },
        { role: "wing", controller: "rotate", amount: 0, durationMs: 70, easing: "linear" }
      ]
    },
    crawl: {
      description: "Legs ripple front-to-back for slow locomotion.",
      steps: [
        { role: "leg", controller: "translateX", amount: 3, durationMs: 240, easing: "easeInOut" },
        { role: "leg", controller: "translateX", amount: -3, durationMs: 240, easing: "easeInOut" },
        { role: "leg", controller: "translateX", amount: 0, durationMs: 200, easing: "easeInOut" }
      ]
    },
    breathe: {
      description: "Abdomen pulses gently while idle.",
      steps: [
        { role: "body", controller: "scaleY", amount: 1.05, durationMs: 1200, easing: "easeInOut" },
        { role: "body", controller: "scaleY", amount: 1, durationMs: 1400, easing: "easeInOut" }
      ]
    }
  }
};

export const VEHICLE: SpeciesSchema = {
  id: "vehicle",
  label: "Vehicle",
  expected: { body: 1, head: 1, wheel: 4, eyes: 2 },
  actions: {
    roll: {
      description: "Wheels spin with motion-blur-friendly rotation.",
      steps: [
        { role: "wheel", controller: "rotate", amount: 360, durationMs: 900, easing: "linear" }
      ]
    },
    bounce: {
      description: "Suspension compresses then rebounds on landing.",
      steps: [
        { role: "body", controller: "translateY", amount: 5, durationMs: 160, easing: "easeOut" },
        { role: "body", controller: "translateY", amount: -2, durationMs: 180, easing: "easeInOut" },
        { role: "body", controller: "translateY", amount: 0, durationMs: 240, easing: "spring" }
      ]
    },
    brakeTilt: {
      description: "Nose dips under braking weight transfer.",
      steps: [
        { role: "body", controller: "rotate", amount: -3, durationMs: 180, easing: "easeOut" },
        { role: "body", controller: "rotate", amount: 1, durationMs: 200, easing: "easeInOut" },
        { role: "body", controller: "rotate", amount: 0, durationMs: 260, easing: "spring" }
      ]
    },
    headlightBlink: {
      description: "Headlights flash once for attention or acknowledgement.",
      steps: [
        { role: "eyes", controller: "scaleY", amount: 0.35, durationMs: 90, holdMs: 60, easing: "easeOut" },
        { role: "eyes", controller: "scaleY", amount: 1, durationMs: 120, easing: "easeInOut" }
      ]
    }
  }
};

export const BLOB: SpeciesSchema = {
  id: "blob",
  label: "Blob (universal fallback)",
  expected: { body: 1, eyes: 2 },
  actions: {
    wobble: {
      description: "Squash-and-stretch jelly wobble; works on any single-mass character.",
      steps: [
        { role: "body", controller: "scaleX", amount: 1.06, durationMs: 260, easing: "easeOut" },
        { role: "body", controller: "scaleY", amount: 0.94, durationMs: 260, easing: "easeInOut" },
        { role: "body", controller: "scaleX", amount: 1, durationMs: 300, easing: "spring" },
        { role: "body", controller: "scaleY", amount: 1, durationMs: 300, easing: "spring" }
      ]
    },
    squish: {
      description: "Pressed-down squash for tap feedback.",
      steps: [
        { role: "body", controller: "scaleY", amount: 0.82, durationMs: 90, easing: "easeOut" },
        { role: "body", controller: "scaleY", amount: 1, durationMs: 220, easing: "spring" }
      ]
    },
    blink: {
      description: "Eye squash blink when eyes are detectable.",
      steps: [
        { role: "eyes", controller: "scaleY", amount: 0.12, durationMs: 110, holdMs: 50, easing: "easeOut" },
        { role: "eyes", controller: "scaleY", amount: 1, durationMs: 130, easing: "easeInOut" }
      ]
    },
    breathe: {
      description: "Slow volume pulse for idle life.",
      steps: [
        { role: "body", controller: "scaleY", amount: 1.03, durationMs: 1500, easing: "easeInOut" },
        { role: "body", controller: "scaleY", amount: 1, durationMs: 1700, easing: "easeInOut" }
      ]
    }
  }
};

export const SPECIES_SCHEMAS: SpeciesSchema[] = [
  HUMAN_BIPED,
  AVIAN_CROW,
  GENERIC_QUADRUPED,
  INSECT,
  VEHICLE,
  BLOB
];

export const SCHEMA_BY_ID = new Map(SPECIES_SCHEMAS.map((schema) => [schema.id, schema]));
