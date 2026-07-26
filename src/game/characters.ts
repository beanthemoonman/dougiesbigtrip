/**
 * Character + world-model weapon assets: the shared CT rig template every
 * humanoid (bots, remotes, the player's death-cam body) is cloned from, the
 * unlit-material flattening the baked-lighting world requires, team tinting,
 * and the hand-bone weapon attach. Extracted from main.ts when it split into
 * shell + session.
 */

import { type AnimationClip, Mesh, MeshMatcapMaterial, type MeshStandardMaterial, Object3D, SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WEAPON_POS, WEAPON_QUAT, WEAPON_SCALE } from '../ai/thirdperson';
import { characterMatcap } from '../render/matcap';
import type { TeamSide as Team } from './spawning';
import ctPlayerUrl from '../../assets/characters/ct_player.glb?url';
import tPlayerUrl from '../../assets/characters/t_player.glb?url';
import rifleUrl from '../../assets/weapons/ak_viewmodel.glb?url';
import pistolUrl from '../../assets/weapons/pistol_viewmodel.glb?url';

// Baked-lighting world has no realtime lights, so the glb's MeshStandardMaterials
// are flattened to a lightless material. MeshBasicMaterial made characters read
// as flat silhouettes; MeshMatcapMaterial shades them from the view-space normal
// instead — same zero lights, but with form. (See src/render/matcap.ts.)
// Matcap skins automatically for a SkinnedMesh in three r170 (no `skinning`
// flag). Keep single materials single: each bot submesh is one primitive with
// zero geometry groups, so a 1-element material *array* would draw nothing (the
// renderer iterates groups) — the model goes invisible.
const toMatcap = (m: MeshStandardMaterial): MeshMatcapMaterial =>
  new MeshMatcapMaterial({ color: m.color, matcap: characterMatcap() });
export function flattenMaterials(root: Object3D): void {
  root.traverse((o) => {
    if (o instanceof SkinnedMesh) {
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => toMatcap(m as MeshStandardMaterial))
        : toMatcap(o.material as MeshStandardMaterial);
    }
  });
}

// Bug 2: bots hold a rifle world-model. No dedicated world-model asset exists,
// so reuse the rifle viewmodel glb, parented to each bot's right-hand bone so
// it tracks the animation. Loaded as its OWN instance because the viewmodel
// rifleScene (session.ts) gets reparented onto the layer-1 viewmodel scene.
// The attach transform lives next to the arm pose it was solved with
// (src/ai/thirdperson.ts) — the two are one calibration, not two.
// ponytail: add a real low-poly world-model + per-bot weapon matching when art
// budget allows.

export interface CharacterAssets {
  /** Hidden per-team template added to the scene so cloning can resolve the
   *  skeleton. Clone `templateFor(team)`, never recolour — the two .glbs carry
   *  their own four-material team palettes (see tools/blender/build_characters.py). */
  templateFor(team: Team): Object3D;
  ctTemplateClips: AnimationClip[];
  /** Parent a rifle/pistol world-model to the rig's right-hand bone. */
  attachBotWeapon(character: Object3D, weapon?: 'rifle' | 'pistol'): void;
}

/**
 * Load both team rigs + world-model weapon templates. Each .glb carries a
 * skinned armature + three animation clips (idle/walk/death); the rigs are
 * identical, so the CT clips drive both. Loaded once; each bot clones the full
 * skeleton+mesh hierarchy and gets its own AnimationMixer.
 */
export async function loadCharacterAssets(scene: Object3D): Promise<CharacterAssets> {
  const loader = new GLTFLoader();
  const [rifleWorldTemplate, pistolWorldTemplate, ctGltf, tGltf] = await Promise.all([
    loader.loadAsync(rifleUrl).then((g) => g.scene),
    loader.loadAsync(pistolUrl).then((g) => g.scene),
    loader.loadAsync(ctPlayerUrl),
    loader.loadAsync(tPlayerUrl),
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
        o.material = new MeshMatcapMaterial({ map: src.map, color: src.color, matcap: characterMatcap() });
      }
    });
    gun.position.copy(WEAPON_POS);
    gun.quaternion.copy(WEAPON_QUAT);
    gun.scale.setScalar(WEAPON_SCALE);
    hand.add(gun);
  }

  const templates: Record<Team, Object3D> = { CT: ctGltf.scene, T: tGltf.scene };
  for (const template of Object.values(templates)) {
    // We need the skinned mesh's skeleton alive on the loaded template so cloning
    // can bind the clone's SkinnedMesh to the clone's own Bone tree. The template
    // itself is never rendered; only its clones are.
    template.traverse((o) => {
      if (o instanceof SkinnedMesh) o.frustumCulled = false;
    });
    flattenMaterials(template);
    // Hide the template — it only exists so three.js can resolve the skeleton
    // reference during clone.
    template.visible = false;
    scene.add(template);
  }

  return {
    templateFor: (team) => templates[team],
    ctTemplateClips: ctGltf.animations,
    attachBotWeapon,
  };
}
