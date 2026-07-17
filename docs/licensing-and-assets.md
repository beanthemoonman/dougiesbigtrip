# Licensing and Assets

Read before adding any file to `assets/`.

---

## The one rule

**No Valve content. Ever.**

Not textures, not models, not sounds, not maps, not decompiled `.vmf`s, not `.vpk` contents,
not "just the dev textures", not "just for testing, I'll swap it later." Valve's assets are
licensed for use *within* their games via the Source SDK; extracting them into a standalone
WebGL project is not covered by any licence you have. The fact that it's a hobby project and
that plenty of people do it anyway doesn't change what the licence says.

Nothing in this project's look actually depends on their files. The look is baked lighting,
texel density, palette discipline, and 90° FOV — all reproducible from CC0 sources. See
`docs/art-direction.md`.

"Inspired by the visual style of" is fine. Style isn't copyrightable. Files are.

Also: don't name it "Counter-Strike: Web" or use their logos, fonts, or map names. Call the map
something else. Trademark is a separate and much more aggressively enforced thing than
copyright.

---

## Licence tiers

| Licence | Attribution required? | Use it? |
|---|---|---|
| **CC0 / Public Domain** | No (but do it anyway) | **Yes — default choice** |
| **CC-BY 4.0** | Yes | Yes, with credit in `CREDITS.md` and an in-game credits screen |
| **CC-BY-SA** | Yes + share-alike | **Avoid.** The share-alike clause has murky implications for the whole project. Not worth the ambiguity. |
| **CC-BY-NC** | Yes, non-commercial only | **Avoid.** Even if you never charge, it forecloses options and "non-commercial" is poorly defined. |
| **"Free for personal use"** | Varies | **No.** Not a licence, just a vibe. |
| **Unknown / found on a forum** | — | **No.** |
| **Ripped from any game** | — | **No.** |

Default answer to "can I use this?" is **no** unless you can name the licence and link the
source page.

---

## Approved sources

| Source | Licence | Best for |
|---|---|---|
| **[Kenney](https://kenney.nl)** | CC0 | Prototype Textures (the orange/grey dev grid — genuinely the Source dev-texture look), blocky characters, weapon packs, UI, audio. Start here for greyboxing. |
| **[Poly Haven](https://polyhaven.com)** | CC0 | PBR materials (sandstone, concrete, painted metal, wood), HDRIs. This is your texture library for the real art pass. |
| **[Quaternius](https://quaternius.com)** | CC0 | Low-poly weapons and props, glTF-ready, stylistically consistent |
| **[ambientCG](https://ambientcg.com)** | CC0 | More PBR materials |
| **[Mixamo](https://mixamo.com)** | Free for use, Adobe account needed | Rigged characters + animation clips. Read their terms; they permit use in projects but they are not CC0. |
| **[Freesound](https://freesound.org)** | Per-file — **check each one** | SFX. Filter to CC0. Many files are CC-BY or CC-BY-NC. |
| **[OpenGameArt](https://opengameart.org)** | Per-file | Mixed quality, mixed licences. Filter to CC0 and verify the uploader actually had rights — OGA has a real problem with re-uploaded ripped content. |
| **[Google Fonts](https://fonts.google.com)** | OFL | HUD text |

Specific picks for this project's palette:

- Poly Haven: `sandstone_blocks_*`, `concrete_wall_*`, `painted_metal_*`, `wood_planks_*`
- Kenney: `Prototype Textures`, `Blaster Kit`, `Blocky Characters`, `Impact Sounds`
- Quaternius: `Ultimate Modular Sci-Fi`, low-poly gun packs

---

## `assets/CREDITS.md` — mandatory

One row per asset. **Written at the moment the asset is added**, not "before release."
"Before release" means a weekend spent reverse-engineering where a texture came from, and at
least one asset you can't identify and have to redo.

```markdown
| File | Source | Author | Licence | URL | Added |
|---|---|---|---|---|---|
| assets/maps/tex/sandstone_2k_diff.ktx2 | Poly Haven | Rob Tuytel | CC0 | https://polyhaven.com/a/sandstone_blocks_02 | 2026-07-16 |
| assets/audio/rifle_fire.ogg | Freesound | user123 | CC-BY 4.0 | https://freesound.org/s/123456/ | 2026-07-16 |
```

Add a CI check that fails if a file under `assets/` has no `CREDITS.md` row. It takes twenty
minutes to write and it's the only thing that makes this stick.

Attribution goes in three places: `CREDITS.md`, an in-game credits screen, and the repo README.

---

## Audio specifically

Gunshot SFX are the highest-risk category. Freesound has plenty of recordings that are
actually lifted from commercial games or films and re-uploaded with a CC0 tag by someone who
had no right to do that. If a "gunshot" sample sounds *exactly* like a game you recognise, it
probably is that game.

Safer options:
- Kenney's audio packs (CC0, synthetic, deliberately stylised)
- Layer and process your own from CC0 impact/noise sources — a gunshot is a transient, a body,
  and a tail; you can build a convincing one from three CC0 elements and it'll be uniquely
  yours

---

## Modifying CC-BY assets

Allowed, and you still attribute. Note the modification:

```
"sandstone_blocks_02" by Rob Tuytel (Poly Haven), CC0. Modified: retinted, tiled, resized to 2K.
```

CC0 requires nothing, but crediting anyway is both decent and useful — six months later you'll
want to know where a texture came from so you can grab the matching normal map.

---

## If you later want to publish this

- Keep it **free**. CC-BY assets are fine commercially, but the moment money is involved the
  trademark question ("is this a Counter-Strike clone?") gets sharper teeth.
- Don't use CS map names, weapon names, logos, or the trademark in the title or metadata.
- An in-game credits screen listing every source, reachable from the main menu.
- A `LICENSES/` directory with the full text of every licence in play.
- If you took a *lot* of care and want to be sure, a lawyer's hour is cheap relative to a
  takedown of something you spent five weeks on. This document is not legal advice.
