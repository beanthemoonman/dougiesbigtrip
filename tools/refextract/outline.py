"""Extract a part's outline curve from a flat-background side-reference photo.

Given a reference like assets/reference/ak/ak-side.png and a bounding box around
one part (the magazine, the grip), trace the part's silhouette and emit a
normalized curve the Blender builder can follow instead of a hand-guessed arc.

Only the *shape* is exported (normalized 0..1 inside the bbox); absolute size
stays a builder constant, so no camera calibration is needed.

Usage:
  python3 tools/refextract/outline.py assets/reference/ak/ak-side.png \
      --bbox 0.44 0.42 0.55 0.98 --axis vertical --samples 24 \
      --out assets/reference/ak/mag.curve.json --debug /tmp/mag_dbg.png

JSON: {image, size:[w,h], bbox_px:[x0,y0,x1,y1], axis, samples:[{t,a,b,c,half}]}
  vertical: t=0 top→1 bottom; a=left edge, b=right edge, c=center, half=half-width
  all of a/b/c/half are fractions of bbox width; t spans the bbox height.
"""
import argparse, json, sys
import numpy as np
from PIL import Image, ImageDraw


def foreground_mask(rgb, thresh):
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, 0)
    return np.linalg.norm(rgb.astype(float) - bg, axis=2) > thresh, bg


def largest_run(idx):
    """Longest contiguous run in a sorted 1-D array of column indices -> (lo,hi)."""
    if len(idx) == 0:
        return None
    splits = np.where(np.diff(idx) > 1)[0]
    runs = np.split(idx, splits + 1)
    r = max(runs, key=len)
    return int(r[0]), int(r[-1])


def trace(mask, bbox_px, axis, samples):
    x0, y0, x1, y1 = bbox_px
    out = []
    if axis == "vertical":
        span, w = y1 - y0, float(x1 - x0)
        for s in range(samples):
            y = int(round(y0 + (s + 0.5) / samples * span))
            cols = np.where(mask[y, x0:x1])[0]
            run = largest_run(cols)
            if run is None:
                continue
            a, b = run
            out.append({"t": round((y - y0) / span, 4),
                        "a": round(a / w, 4), "b": round(b / w, 4),
                        "c": round((a + b) / 2 / w, 4),
                        "half": round((b - a) / 2 / w, 4)})
    else:  # horizontal
        span, h = x1 - x0, float(y1 - y0)
        for s in range(samples):
            x = int(round(x0 + (s + 0.5) / samples * span))
            rows = np.where(mask[y0:y1, x])[0]
            run = largest_run(rows)
            if run is None:
                continue
            a, b = run
            out.append({"t": round((x - x0) / span, 4),
                        "a": round(a / h, 4), "b": round(b / h, 4),
                        "c": round((a + b) / 2 / h, 4),
                        "half": round((b - a) / 2 / h, 4)})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--bbox", type=float, nargs=4, required=True,
                    metavar=("X0", "Y0", "X1", "Y1"), help="fractions of image 0..1")
    ap.add_argument("--axis", choices=["vertical", "horizontal"], default="vertical")
    ap.add_argument("--samples", type=int, default=24)
    ap.add_argument("--thresh", type=float, default=30.0)
    ap.add_argument("--out", required=True)
    ap.add_argument("--debug")
    args = ap.parse_args()

    img = Image.open(args.image).convert("RGB")
    rgb = np.asarray(img)
    h, w, _ = rgb.shape
    mask, _ = foreground_mask(rgb, args.thresh)
    bx = [int(args.bbox[0] * w), int(args.bbox[1] * h),
          int(args.bbox[2] * w), int(args.bbox[3] * h)]
    pts = trace(mask, bx, args.axis, args.samples)
    assert len(pts) >= args.samples * 0.6, \
        f"only traced {len(pts)}/{args.samples} rows — bad bbox or threshold?"

    data = {"image": args.image, "size": [w, h], "bbox_px": bx,
            "axis": args.axis, "samples": pts}
    with open(args.out, "w") as f:
        json.dump(data, f, indent=1)
    print(f"{args.out}: {len(pts)} samples")

    if args.debug:
        dbg = img.copy()
        d = ImageDraw.Draw(dbg)
        d.rectangle(bx, outline=(0, 120, 255), width=2)
        bw = bx[2] - bx[0]
        for p in pts:
            if args.axis == "vertical":
                y = bx[1] + p["t"] * (bx[3] - bx[1])
                for k, col in (("a", (255, 0, 0)), ("b", (0, 200, 0)), ("c", (255, 200, 0))):
                    x = bx[0] + p[k] * bw
                    d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=col)
        dbg.save(args.debug)
        print("debug ->", args.debug)


if __name__ == "__main__":
    main()
