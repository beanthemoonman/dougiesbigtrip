/**
 * Character + world-model weapon assets: the shared CT rig template every
 * humanoid (bots, remotes, the player's death-cam body) is cloned from, the
 * unlit-material flattening the baked-lighting world requires, team tinting,
 * and the hand-bone weapon attach. Extracted from main.ts when it split into
 * shell + session.
 */

import { type AnimationClip, Color, Mesh, MeshBasicMaterial, type MeshStandardMaterial, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import ctPlayerUrl from '../../assets/characters/ct_player.glb?url';
import rifleUrl from '../../assets/weapons/ak_viewmodel.glb?url';
import pistolUrl from '../../assets/weapons/pistol_viewmodel.glb?url';

// Tint teammates so they read apart from enemies at a glance (one shared CT
// model). CT keep their baked colour; T get a warm tan.
export const T_TINT = new Color(0xc8a06a);

// Baked-lighting world has no realtime lights, so flatten the glb's
// MeshStandardMaterials to unlit MeshBasicMaterial.
// MeshBasicMaterial skins automatically for a SkinnedMesh in three r170 (no
// `skinning` flag). Keep single materials single: each bot submesh is one
// primitive with zero geometry groups, so a 1-element material *array* would
// draw nothing (the renderer iterates groups) — the model goes invisible.
const toBasic = (m: MeshStandardMaterial): MeshBasicMaterial => new MeshBasicMaterial({ color: m.color });
export function flattenMaterials(root: Object3D): void {
  root.traverse((o) => {
    if (o instanceof SkinnedMesh) {
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => toBasic(m as MeshStandardMaterial))
        : toBasic(o.material as MeshStandardMaterial);
    }
  });
}

/** Recolour every skinned submesh (team tint / death-cam body). */
export function tintCharacter(root: Object3D, color: Color): void {
  root.traverse((o) => {
    if (o instanceof SkinnedMesh) {
      const m = o.material;
      if (Array.isArray(m)) m.forEach((mm) => (mm as MeshBasicMaterial).color.copy(color));
      else (m as MeshBasicMaterial).color.copy(color);
    }
  });
}

/** The baked base colour of the first skinned submesh (the CT uniform). */
export function baseCharacterColor(root: Object3D): Color {
  const out = new Color();
  root.traverse((o) => {
    if (o instanceof SkinnedMesh) {
      const m = o.material;
      out.copy(((Array.isArray(m) ? m[0] : m) as MeshBasicMaterial).color);
    }
  });
  return out;
}

// Bug 2: bots hold a rifle world-model. No dedicated world-model asset exists,
// so reuse the rifle viewmodel glb, parented to each bot's right-hand bone so
// it tracks the animation. Loaded as its OWN instance because the viewmodel
// rifleScene (session.ts) gets reparented onto the layer-1 viewmodel scene.
// ponytail: grip offset is a hand-tuned calibration knob, not derivable — nudge
// these if the gun clips the hand or points wrong. Add a real low-poly
// world-model + per-bot weapon matching when art budget allows.
// The viewmodel barrel runs along +X (away from camera); yaw -π/2 rotates it
// down the arm so the barrel points forward out of the bot's chest. Verify with
// ACC-014 step 2 after any change.
const BOT_GUN_POS = new Vector3(0, 0.02, 0.08); // metres, in hand-bone space
// Gun orientation in hand-bone space. SOLVED (not eyeballed): measured live in
// the running scene so the barrel (weapon local −Z) points along the model's
// forward (−Z) and the sights stay up (+Y). Value = inv(handWorld) · rootWorld
// for the weapon-hold hand pose; the bot yaw cancels, so it's a constant.
// ponytail: coupled to the RightHand pose quat in src/ai/thirdperson.ts — if
// that hand rotation changes, re-measure this (barrel points down otherwise).
const BOT_GUN_QUAT = new Quaternion(-0.998, 0.0385, 0.0492, 0.0074);

export interface CharacterAssets {
  /** Hidden template added to the scene so cloning can resolve the skeleton. */
  ctTemplateScene: Object3D;
  ctTemplateClips: AnimationClip[];
  /** Parent a rifle/pistol world-model to the rig's right-hand bone. */
  attachBotWeapon(character: Object3D, weapon?: 'rifle' | 'pistol'): void;
}

/**
 * Load the CT rig + world-model weapon templates. The .glb carries a skinned
 * armature + three animation clips (idle/walk/death). Loaded once; each bot
 * clones the full skeleton+mesh hierarchy and gets its own AnimationMixer.
 * Template clips are shared across all mixers.
 */
export async function loadCharacterAssets(scene: Object3D): Promise<CharacterAssets> {
  const loader = new GLTFLoader();
  const [rifleWorldTemplate, pistolWorldTemplate, ctGltf] = await Promise.all([
    loader.loadAsync(rifleUrl).then((g) => g.scene),
    loader.loadAsync(pistolUrl).then((g) => g.scene),
    loader.loadAsync(ctPlayerUrl),
  ]);

  function attachBotWeapon(character: Object3D, weapon: 'rifle' | 'pistol' = 'rifle'): void {
    let hand: Object3D | undefined;
    character.traverse((o) => {
      if (!hand && /righthand/i.test(o.name)) hand = o;
    });
    if (!hand) return; // rig without a named right-hand bone → bot just goes unarmed
    const gun = (weapon === 'pistol' ? pistolWorldTemplate : rifleWorldTemplate).clone(true);
    gun.traverse((o) => {
      o.layers.set(0); // world layer (viewmodel is layer 1)
      if (o instanceof Mesh) {
        const src = o.material as MeshStandardMaterial;
        o.material = new MeshBasicMaterial({ map: src.map, color: src.color });
      }
    });
    gun.position.copy(BOT_GUN_POS);
    gun.quaternion.copy(BOT_GUN_QUAT);
    hand.add(gun);
  }

  const ctTemplateScene = ctGltf.scene;
  // We need the skinned mesh's skeleton alive on the loaded template so cloning
  // can bind the clone's SkinnedMesh to the clone's own Bone tree. The template
  // itself is never rendered; only its clones are.
  ctTemplateScene.traverse((o) => {
    if (o instanceof SkinnedMesh) o.frustumCulled = false;
  });
  flattenMaterials(ctTemplateScene);
  // Hide the template — it only exists so three.js can resolve the skeleton
  // reference during clone.
  ctTemplateScene.visible = false;
  scene.add(ctTemplateScene);

  return { ctTemplateScene, ctTemplateClips: ctGltf.animations, attachBotWeapon };
}
