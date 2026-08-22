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

export const SPECIES_SCHEMAS: SpeciesSchema[] = [HUMAN_BIPED, AVIAN_CROW];

export const SCHEMA_BY_ID = new Map(SPECIES_SCHEMAS.map((schema) => [schema.id, schema]));
