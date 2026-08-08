//! Portable navmesh pathfinding over the walkable-triangle soup.
//! Reads `assets/maps/de_douglas.navmesh.tris.bin` (format in
//! docs/navmesh-pipeline.md: magic NVMT, v1, verts, indices).
//! Builds shared-edge adjacency, A* over triangle centroids, and
//! funnel/string-pull smoothing.
//!
//! This is what bots actually route with, on BOTH ports: the server links it
//! natively and the browser gets the identical code through `sim.wasm`. The
//! 13-node `nav_graph` still picks *where* to go (the shared goal-selection
//! spec); this decides *how to walk there*.

/// Y-axis up, in metres. Triangles are the walkable surface (recast detail mesh).
pub struct NavMesh {
    pub verts: Vec<[f32; 3]>,
    pub tris: Vec<[u32; 3]>, // indices into verts, 3 per tri
    adj: Vec<Vec<usize>>,     // adj[t] = list of neighbouring triangle indices
    /// Vertex index -> canonical id, welding coincident positions. The baked
    /// blob is an unindexed soup, so this is what makes two triangles that meet
    /// along an edge recognisable as neighbours at all.
    canon: Vec<u32>,
}

/// The magic bytes for our portable navmesh format.
const NAV_MAGIC: u32 = 0x544D564E; // "NVMT"

/// The baked navmesh, compiled in. `include_bytes!` rather than a load call
/// because it has to reach two very different hosts — a tokio server and a
/// browser — and neither should need plumbing for a 39 KB constant that is
/// versioned in the repo alongside the map it describes.
const TRIS_BIN: &[u8] = include_bytes!("../../assets/maps/de_douglas.navmesh.tris.bin");

static MESH: std::sync::OnceLock<Option<NavMesh>> = std::sync::OnceLock::new();

/// The shared navmesh, parsed once. `None` only if the baked blob is malformed,
/// in which case callers fall back to nav-graph hops rather than freezing.
pub fn mesh() -> Option<&'static NavMesh> {
    MESH.get_or_init(|| NavMesh::from_bytes(TRIS_BIN)).as_ref()
}

impl NavMesh {
    /// Parse the portable tris.bin file from raw bytes.
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        if data.len() < 16 {
            return None;
        }
        let magic = u32_from_le(&data[0..4]);
        let version = u32_from_le(&data[4..8]);
        if magic != NAV_MAGIC || version != 1 {
            return None;
        }
        let vert_count = u32_from_le(&data[8..12]) as usize;
        let tri_count = u32_from_le(&data[12..16]) as usize;

        let vert_bytes = vert_count * 12;
        let idx_bytes = tri_count * 12;
        let expected = 16 + vert_bytes + idx_bytes;
        if data.len() < expected {
            return None;
        }

        let mut verts = Vec::with_capacity(vert_count);
        for i in 0..vert_count {
            let off = 16 + i * 12;
            verts.push([
                f32_from_le(&data[off..off + 4]),
                f32_from_le(&data[off + 4..off + 8]),
                f32_from_le(&data[off + 8..off + 12]),
            ]);
        }

        let mut tris = Vec::with_capacity(tri_count);
        let idx_off = 16 + vert_bytes;
        for i in 0..tri_count {
            let off = idx_off + i * 12;
            tris.push([
                u32_from_le(&data[off..off + 4]),
                u32_from_le(&data[off + 4..off + 8]),
                u32_from_le(&data[off + 8..off + 12]),
            ]);
        }

        let canon = weld_vertices(&verts);
        let adj = build_adjacency(&tris, tri_count, &canon);
        Some(NavMesh { verts, tris, adj, canon })
    }

    /// Find a smoothed path from `from` to `to` over the triangle mesh.
    /// Returns a list of waypoint positions (world-space, Y-up), or an empty
    /// vector if no path exists.
    pub fn find_path(&self, from: [f32; 3], to: [f32; 3]) -> Vec<[f32; 3]> {
        let start_tri = self.closest_tri(from);
        let goal_tri = self.closest_tri(to);
        if start_tri.is_none() || goal_tri.is_none() {
            return vec![];
        }
        let start = start_tri.unwrap();
        let goal = goal_tri.unwrap();

        if start == goal {
            return vec![from, to];
        }

        // A* over triangle centroids
        let tri_path = self.astar(start, goal);
        if tri_path.is_empty() {
            return vec![];
        }

        // Funnel smoothing over the triangle path
        self.funnel(tri_path, from, to)
    }

    /// Find the triangle whose centroid is closest to `p`, snapping onto the
    /// mesh with a small vertical tolerance (HALF_EXTENTS from the TS nav).
    fn closest_tri(&self, p: [f32; 3]) -> Option<usize> {
        let half_extents = 0.5f32; // ~50 cm vertical tolerance
        let mut best: Option<(usize, f32)> = None;
        for (i, tri) in self.tris.iter().enumerate() {
            let centroid = self.tri_centroid(*tri);
            let dy = (p[1] - centroid[1]).abs();
            if dy > half_extents {
                continue;
            }
            let dx = p[0] - centroid[0];
            let dz = p[2] - centroid[2];
            let d2 = dx * dx + dz * dz;
            if best.is_none() || d2 < best.unwrap().1 {
                best = Some((i, d2));
            }
        }
        best.map(|(i, _)| i)
    }

    fn tri_centroid(&self, tri: [u32; 3]) -> [f32; 3] {
        let a = self.verts[tri[0] as usize];
        let b = self.verts[tri[1] as usize];
        let c = self.verts[tri[2] as usize];
        [
            (a[0] + b[0] + c[0]) / 3.0,
            (a[1] + b[1] + c[1]) / 3.0,
            (a[2] + b[2] + c[2]) / 3.0,
        ]
    }

    /// A* from start triangle to goal triangle. Returns indices of triangles
    /// from start to goal (inclusive).
    fn astar(&self, start: usize, goal: usize) -> Vec<usize> {
        let n = self.tris.len();
        let mut open = std::collections::BinaryHeap::new();
        let mut g = vec![f32::MAX; n];
        let mut parent = vec![usize::MAX; n];

        g[start] = 0.0;
        let h = self.heuristic(start, goal);
        open.push(State { f: h, g: 0.0, idx: start });

        while let Some(State { idx, .. }) = open.pop() {
            if idx == goal {
                return self.reconstruct_path(&parent, goal);
            }

            for &nb in &self.adj[idx] {
                let cost = self.edge_cost(idx, nb);
                let tentative = g[idx] + cost;
                if tentative < g[nb] {
                    g[nb] = tentative;
                    parent[nb] = idx;
                    let h = self.heuristic(nb, goal);
                    open.push(State { f: tentative + h, g: tentative, idx: nb });
                }
            }
        }

        vec![]
    }

    fn heuristic(&self, a: usize, b: usize) -> f32 {
        let ca = self.tri_centroid(self.tris[a]);
        let cb = self.tri_centroid(self.tris[b]);
        let dx = ca[0] - cb[0];
        let dz = ca[2] - cb[2];
        // Euclidean horizontal (no Y — bots walk flat).
        (dx * dx + dz * dz).sqrt()
    }

    /// Centroid-to-centroid horizontal distance. This MUST be in the same unit
    /// as `heuristic` (metres): a constant hop cost against a metre-valued
    /// heuristic makes h wildly overestimate the remaining g, which drops A*
    /// to greedy best-first and returns erratic, non-shortest routes.
    fn edge_cost(&self, a: usize, b: usize) -> f32 {
        self.heuristic(a, b)
    }

    fn reconstruct_path(&self, parent: &[usize], mut goal: usize) -> Vec<usize> {
        let mut path = Vec::new();
        while goal != usize::MAX {
            path.push(goal);
            goal = parent[goal];
        }
        path.reverse();
        path
    }

    /// Turn the A* triangle corridor into a waypoint list.
    ///
    /// This walks the *midpoint* of each portal (the edge shared by consecutive
    /// triangles) and then drops waypoints that are near-collinear with their
    /// neighbours. It is deliberately not the classic apex/funnel string-pull:
    /// that version needs exact left/right portal handedness and degenerate-case
    /// handling, and the one that lived here produced a 342 m sawtooth for a
    /// 48 m crossing because it flipped sides at arbitrary portals.
    ///
    /// Portal midpoints can't self-cross — the corridor is a strip and each
    /// midpoint lies inside it — so the route is always walkable, just a little
    /// wider on corners than a true string-pull.
    ///
    /// ponytail: midpoints + collinear thinning. Swap in a real funnel only if
    /// bots visibly bulge on corners; steering + `WAYPOINT_RADIUS` already hides
    /// most of it.
    fn funnel(&self, tri_path: Vec<usize>, from: [f32; 3], to: [f32; 3]) -> Vec<[f32; 3]> {
        if tri_path.is_empty() {
            return vec![];
        }

        let mut path = Vec::with_capacity(tri_path.len() + 2);
        path.push(from);
        for w in tri_path.windows(2) {
            if let Some((a, b)) = self.shared_edge(w[0], w[1]) {
                path.push([
                    (a[0] + b[0]) * 0.5,
                    (a[1] + b[1]) * 0.5,
                    (a[2] + b[2]) * 0.5,
                ]);
            }
        }
        path.push(to);
        path = thin_collinear(path);

        // Project waypoints onto the ground (Y from the mesh at that XZ).
        // Use the closest triangle's centroid Y for each waypoint.
        for p in path.iter_mut().skip(1) {
            if let Some(tri_idx) = self.closest_tri(*p) {
                let c = self.tri_centroid(self.tris[tri_idx]);
                p[1] = c[1];
            }
        }

        path
    }

    /// Returns the two endpoints of the edge shared by triangles a and b, if any.
    fn shared_edge(&self, a: usize, b: usize) -> Option<([f32; 3], [f32; 3])> {
        let ta = self.tris[a];
        let tb = self.tris[b];
        let c = |i: u32| self.canon[i as usize];

        // Match on welded ids, not raw indices — see `weld_vertices`. Collect
        // the vertices of `a` that also appear in `b`.
        let mut unique: Vec<u32> = Vec::new();
        for &va in &[ta[0], ta[1], ta[2]] {
            let shared = [tb[0], tb[1], tb[2]].iter().any(|&vb| c(vb) == c(va));
            if shared && !unique.iter().any(|&u| c(u) == c(va)) {
                unique.push(va);
            }
        }

        if unique.len() == 2 {
            let v0 = self.verts[unique[0] as usize];
            let v1 = self.verts[unique[1] as usize];
            // Order the portal (left, right) relative to travelling a -> b. The
            // string-pull below assumes that handedness; returning the two
            // vertices in whatever order they happened to be indexed makes the
            // funnel flip sides at random portals and emit crossing paths.
            let ca = self.tri_centroid(self.tris[a]);
            let cb = self.tri_centroid(self.tris[b]);
            if orient2d(ca, cb, v0) >= 0.0 {
                Some((v0, v1))
            } else {
                Some((v1, v0))
            }
        } else {
            None
        }
    }
}

/// 2D cross product sign in XZ plane. Positive = left turn.
fn orient2d(a: [f32; 3], b: [f32; 3], c: [f32; 3]) -> f32 {
    (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])
}

/// Perpendicular distance (XZ) from `p` to the segment `a`-`b`.
fn point_seg_dist(p: [f32; 3], a: [f32; 3], b: [f32; 3]) -> f32 {
    let (vx, vz) = (b[0] - a[0], b[2] - a[2]);
    let len_sq = vx * vx + vz * vz;
    let t = if len_sq <= 1e-9 {
        0.0
    } else {
        (((p[0] - a[0]) * vx + (p[2] - a[2]) * vz) / len_sq).clamp(0.0, 1.0)
    };
    let (cx, cz) = (a[0] + vx * t, a[2] + vz * t);
    ((p[0] - cx).powi(2) + (p[2] - cz).powi(2)).sqrt()
}

/// How far a waypoint may sit off the line between its neighbours before it is
/// considered load-bearing. A detail-mesh corridor emits a portal midpoint every
/// half metre or so down a straight corridor; without this a 48 m walk carries
/// ~85 waypoints that all say "keep going straight".
const THIN_TOLERANCE: f32 = 0.25; // m

/// Drop waypoints that lie within `THIN_TOLERANCE` of the straight line between
/// the last kept waypoint and the next one. Endpoints are always kept.
fn thin_collinear(path: Vec<[f32; 3]>) -> Vec<[f32; 3]> {
    if path.len() <= 2 {
        return path;
    }
    let mut out = Vec::with_capacity(path.len());
    out.push(path[0]);
    for i in 1..path.len() - 1 {
        let prev = *out.last().unwrap();
        if point_seg_dist(path[i], prev, path[i + 1]) > THIN_TOLERANCE {
            out.push(path[i]);
        }
    }
    out.push(path[path.len() - 1]);
    out
}

/// Quantisation for position welding: 1 mm. Recast emits detail-mesh vertices
/// that coincide exactly across a shared edge, so this only has to absorb f32
/// round-trip noise, not real tolerance.
const WELD_Q: f32 = 1000.0;

fn weld_key(v: [f32; 3]) -> (i32, i32, i32) {
    (
        (v[0] * WELD_Q).round() as i32,
        (v[1] * WELD_Q).round() as i32,
        (v[2] * WELD_Q).round() as i32,
    )
}

/// Canonical vertex id per vertex index, welding coincident positions together.
///
/// The baked blob is an *unindexed* soup — `de_douglas.navmesh.tris.bin` carries
/// 813 triangles and 2439 vertices, exactly 3 per triangle, so no two triangles
/// ever share a vertex *index*. Matching edges by index therefore finds zero
/// neighbours and every triangle is an island, which is why pathfinding here
/// returned an empty route for every query. Adjacency has to be by position.
fn weld_vertices(verts: &[[f32; 3]]) -> Vec<u32> {
    use std::collections::HashMap;
    let mut canon_of: HashMap<(i32, i32, i32), u32> = HashMap::new();
    let mut out = Vec::with_capacity(verts.len());
    for v in verts {
        let next = canon_of.len() as u32;
        out.push(*canon_of.entry(weld_key(*v)).or_insert(next));
    }
    out
}

/// Build shared-edge adjacency list over welded vertex ids.
fn build_adjacency(tris: &[[u32; 3]], n: usize, canon: &[u32]) -> Vec<Vec<usize>> {
    use std::collections::HashMap;

    let c = |i: u32| canon[i as usize];
    let mut edge_map: HashMap<(u32, u32), Vec<usize>> = HashMap::new();

    for (i, tri) in tris.iter().enumerate() {
        let (a, b, cc) = (c(tri[0]), c(tri[1]), c(tri[2]));
        let edges = [
            (a.min(b), a.max(b)),
            (b.min(cc), b.max(cc)),
            (cc.min(a), cc.max(a)),
        ];
        for e in &edges {
            edge_map.entry(*e).or_default().push(i);
        }
    }

    let mut adj = vec![Vec::new(); n];
    for tris in edge_map.values() {
        // A manifold edge joins exactly 2 triangles. Non-manifold edges (3+)
        // are skipped rather than guessed at.
        if tris.len() == 2 {
            let a = tris[0];
            let b = tris[1];
            adj[a].push(b);
            adj[b].push(a);
        }
    }
    adj
}

fn u32_from_le(buf: &[u8]) -> u32 {
    u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]])
}

fn f32_from_le(buf: &[u8]) -> f32 {
    f32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]])
}

/// Priority queue state for A*.
#[derive(PartialEq)]
struct State {
    f: f32,
    g: f32,
    idx: usize,
}

impl Eq for State {}

impl std::cmp::Ord for State {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // BinaryHeap is max-heap, so reverse to get min-heap.
        other.f.partial_cmp(&self.f).unwrap_or(std::cmp::Ordering::Equal)
    }
}

impl std::cmp::PartialOrd for State {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_mesh() -> NavMesh {
        // A simple 4-vertex, 2-triangle mesh forming a square.
        // Tri 0: (0,0,0) (1,0,0) (1,0,1)
        // Tri 1: (0,0,0) (1,0,1) (0,0,1)
        let verts = vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 0.0, 1.0],
            [0.0, 0.0, 1.0],
        ];
        let tris = vec![[0, 1, 2], [0, 2, 3]];
        let canon = weld_vertices(&verts);
        let adj = build_adjacency(&tris, 2, &canon);
        NavMesh { verts, tris, adj, canon }
    }

    #[test]
    fn adjacency_is_built() {
        let mesh = make_test_mesh();
        assert_eq!(mesh.adj.len(), 2);
        assert!(mesh.adj[0].contains(&1));
        assert!(mesh.adj[1].contains(&0));
    }

    #[test]
    fn find_path_on_simple_mesh() {
        let mesh = make_test_mesh();
        let path = mesh.find_path([0.1, 0.0, 0.1], [0.9, 0.0, 0.9]);
        assert!(!path.is_empty(), "should find a path on the simple mesh");
        // Should be at least start + end
        assert!(path.len() >= 2);
    }

    /// The baked blob must parse and be *connected*. This is the test that
    /// fails if adjacency regresses to matching raw vertex indices: the soup is
    /// unindexed, so index matching yields 813 isolated triangles and every
    /// query returns an empty route.
    #[test]
    fn real_mesh_is_connected_enough_to_route() {
        let m = mesh().expect("baked navmesh must parse");
        assert!(m.tris.len() > 500, "expected the de_douglas detail mesh");
        let isolated = m.adj.iter().filter(|a| a.is_empty()).count();
        assert_eq!(isolated, 0, "no triangle may be an island");
    }

    /// Bots route around the map, not through it. Both spawn ends must be
    /// mutually reachable, and the route has to be a real corridor walk rather
    /// than the straight line (which passes through the spine wall).
    #[test]
    fn routes_across_the_map_the_long_way_round() {
        let m = mesh().expect("baked navmesh must parse");
        let p = m.find_path([-15.0, 0.05, -24.0], [-15.0, 0.05, 24.0]);
        assert!(p.len() >= 4, "cross-map route should have real waypoints, got {}", p.len());
        let len: f32 = p.windows(2)
            .map(|w| ((w[1][0] - w[0][0]).powi(2) + (w[1][2] - w[0][2]).powi(2)).sqrt())
            .sum();
        // Straight line is 48 m and goes through geometry; a walkable route is
        // necessarily longer. The upper bound catches the sawtooth regression
        // the old apex/funnel produced (it returned 342 m for this query).
        assert!(len > 48.0, "route must not cut through the map: {len:.1} m");
        assert!(len < 150.0, "route is sawtoothing, not walking: {len:.1} m");
    }

    /// Consecutive waypoints must be close together; a big jump means the route
    /// leaves the corridor and the bot would walk into a wall between them.
    #[test]
    fn waypoints_are_short_hops() {
        let m = mesh().expect("baked navmesh must parse");
        let p = m.find_path([-15.0, 0.05, -18.0], [-15.0, 0.05, 18.0]);
        assert!(p.len() >= 4);
        for w in p.windows(2) {
            let d = ((w[1][0] - w[0][0]).powi(2) + (w[1][2] - w[0][2]).powi(2)).sqrt();
            assert!(d < 12.0, "waypoint gap {d:.1} m is a straight-line shortcut");
        }
    }

    #[test]
    fn thinning_keeps_corners_and_drops_straights() {
        // A straight run with a right-angle corner: the collinear midpoints go,
        // the corner and both endpoints stay.
        let path = vec![
            [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0], [3.0, 0.0, 0.0],
            [3.0, 0.0, 1.0], [3.0, 0.0, 2.0],
        ];
        let out = thin_collinear(path);
        assert_eq!(out.len(), 3, "expected start, corner, end — got {out:?}");
        assert_eq!(out[1], [3.0, 0.0, 0.0]);
    }

    #[test]
    fn shared_edge_returns_correct_edge() {
        let mesh = make_test_mesh();
        let edge = mesh.shared_edge(0, 1);
        assert!(edge.is_some());
        // The shared edge should be between vertices 0 and 2 (the diagonal)
        let (a, b) = edge.unwrap();
        let keys: Vec<_> = [a, b]
            .iter()
            .map(|v| (v[0].to_bits(), v[1].to_bits(), v[2].to_bits()))
            .collect();
        let v0_key = (0.0f32.to_bits(), 0.0f32.to_bits(), 0.0f32.to_bits());
        let v2_key = (1.0f32.to_bits(), 0.0f32.to_bits(), 1.0f32.to_bits());
        assert!(keys.contains(&v0_key));
        assert!(keys.contains(&v2_key));
    }

    #[test]
    fn parse_real_tris_bin() {
        let path = std::path::Path::new("../assets/maps/de_douglas.navmesh.tris.bin");
        if !path.exists() {
            eprintln!("skipping parse_real_tris_bin: file not found");
            return;
        }
        let data = std::fs::read(path).expect("read tris.bin");
        let mesh = NavMesh::from_bytes(&data);
        assert!(mesh.is_some(), "should parse the real navmesh file");
        let m = mesh.unwrap();
        assert!(m.verts.len() > 0);
        assert!(m.tris.len() > 0);
        assert!(m.adj.len() == m.tris.len());
    }
}
