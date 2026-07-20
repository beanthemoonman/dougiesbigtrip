/// Rapier3D physics world wrapper — map collider loading, capsule shape management,
/// and kinematic player bodies (one per slot). See docs/source-movement.md: the
/// accel/friction curve and collide-and-slide loop are hand-rolled in
/// movement.rs; this module only wraps Rapier for the shape-cast queries that
/// the hand-rolled code needs.
///
/// The sim uses f64 for all movement math (matching JS Number semantics); Rapier
/// physics runs in f32. Conversion is done at this boundary via (as f32) casts.
use rapier3d::prelude::*;
use crate::constants::GRAVITY;

const GRAVITY_F32: f32 = GRAVITY as f32;

/// The sim-side physics world: owns the Rapier world, the static map colliders,
/// and kinematic bodies for every player slot. Each player's actual
/// position/velocity are owned by PlayerState in movement.rs; the kinematic
/// bodies just keep the Rapier world informed so other systems (bots, hit
/// detection, PvP collision) can query against them.
///
/// Phase 6.4: multiple player bodies so PvP shapecasts see other players.
/// The WASM sim only uses the default (index-0) body; the native server calls
/// add_player_body() per slot.
pub struct SimWorld {
    pub physics: PhysicsWorld,
    pub standing_shape: SharedShape,
    pub ducked_shape: SharedShape,
    /// Kinematic body + collider per player slot (index 0 = human, 1+ = bots).
    /// Indices must match the wasm state vector 1:1.
    body_handles: Vec<(RigidBodyHandle, ColliderHandle)>,
    /// True after the first step() call, which initialises the broad phase
    /// so queries can see static colliders.
    broad_phase_ready: bool,
}

fn create_kinematic_player_body(physics: &mut PhysicsWorld) -> (RigidBodyHandle, ColliderHandle) {
    let standing_half_height = crate::constants::STANDING_HALF_HEIGHT as f32;
    let player_radius = crate::constants::PLAYER_RADIUS as f32;
    let body = RigidBodyBuilder::kinematic_position_based().build();
    let body_handle = physics.insert_body(body);
    let collider = ColliderBuilder::capsule_y(standing_half_height, player_radius).build();
    let collider_handle = physics.insert_collider(collider, Some(body_handle));
    (body_handle, collider_handle)
}

impl SimWorld {
    pub fn new() -> Self {
        let mut physics = PhysicsWorld::new();

        physics.gravity = Vector::new(0.0, -GRAVITY_F32, 0.0);

        let standing_half_height = crate::constants::STANDING_HALF_HEIGHT as f32;
        let ducked_half_height = crate::constants::DUCKED_HALF_HEIGHT as f32;
        let player_radius = crate::constants::PLAYER_RADIUS as f32;

        let standing_shape = ColliderBuilder::capsule_y(standing_half_height, player_radius)
            .build()
            .shared_shape()
            .clone();
        let ducked_shape = ColliderBuilder::capsule_y(ducked_half_height, player_radius)
            .build()
            .shared_shape()
            .clone();

        let (body0, coll0) = create_kinematic_player_body(&mut physics);

        Self {
            physics,
            standing_shape,
            ducked_shape,
            body_handles: vec![(body0, coll0)],
            broad_phase_ready: false,
        }
    }

    /// Add a static axis-aligned cuboid collider (walls, floors, ramps).
    /// `center` + `half_extents` in metres, `rotation_yaw` in radians around Y.
    pub fn add_static_box(
        &mut self,
        center_x: f64,
        center_y: f64,
        center_z: f64,
        half_x: f64,
        half_y: f64,
        half_z: f64,
        rotation_yaw: f64,
    ) {
        let body = RigidBodyBuilder::fixed();
        let body_handle = self.physics.insert_body(body);

        let translation = Vector::new(center_x as f32, center_y as f32, center_z as f32);
        let collider = if rotation_yaw.abs() < 1e-9 {
            ColliderBuilder::cuboid(half_x as f32, half_y as f32, half_z as f32)
                .translation(translation)
                .build()
        } else {
            let rotation = Rotation::from_rotation_y(rotation_yaw as f32);
            let pose = Pose::from_parts(translation, rotation);
            ColliderBuilder::cuboid(half_x as f32, half_y as f32, half_z as f32)
                .position(pose)
                .build()
        };

        self.physics.insert_collider(collider, Some(body_handle));
    }

    /// Add a ramp (angled box) defined by start/end points of its top surface centreline,
    /// width, and thickness. The box is oriented along the ramp angle.
    pub fn add_ramp(
        &mut self,
        start_x: f64, start_y: f64, start_z: f64,
        end_x: f64, end_y: f64, end_z: f64,
        width: f64,
        thickness: f64,
    ) {
        let dx = (end_x - start_x) as f32;
        let dy = (end_y - start_y) as f32;
        let dz = (end_z - start_z) as f32;
        let length = (dx.powi(2) + dy.powi(2) + dz.powi(2)).sqrt();
        if length < 1e-9 {
            return;
        }
        let angle = dy.atan2(dx);
        let normal_x = -angle.sin();
        let normal_y = angle.cos();

        let cx = ((start_x + end_x) / 2.0) as f32 + normal_x * (-thickness as f32 / 2.0);
        let cy = ((start_y + end_y) / 2.0) as f32 + normal_y * (-thickness as f32 / 2.0);
        let cz = ((start_z + end_z) / 2.0) as f32;

        let rotation = Rotation::from_rotation_z(angle);
        let pose = Pose::from_parts(Vector::new(cx, cy, cz), rotation);

        let body = RigidBodyBuilder::fixed();
        let body_handle = self.physics.insert_body(body);
        let collider = ColliderBuilder::cuboid(length / 2.0, thickness as f32 / 2.0, width as f32 / 2.0)
            .position(pose)
            .build();
        self.physics.insert_collider(collider, Some(body_handle));
    }

    /// Create an additional kinematic player body (for a new server slot).
    /// Returns handles the caller must remember so it can pass the correct
    /// collider handle as exclude during tick_movement. Pushes to the
    /// internal vec so the index matches the wasm state vector.
    pub fn add_player_body(&mut self) -> (RigidBodyHandle, ColliderHandle) {
        let handles = create_kinematic_player_body(&mut self.physics);
        self.body_handles.push(handles);
        handles
    }

    /// Remove a player body from the internal vec. The Rapier bodies/colliders
    /// stay in the physics world (no clean-up API) — they are simply orphaned.
    /// Must be called with index matching remove from the state vec to keep
    /// indices in sync.
    pub fn remove_player_body(&mut self, index: usize) {
        if index < self.body_handles.len() {
            self.body_handles.remove(index);
        }
    }

    /// Update a specific kinematic player body position for query-awareness.
    pub fn sync_player_body(
        &mut self,
        rigid_handle: RigidBodyHandle,
        coll_handle: ColliderHandle,
        feet_x: f64,
        feet_y: f64,
        feet_z: f64,
        ducked: bool,
    ) {
        let standing_hh = crate::constants::STANDING_HALF_HEIGHT as f32;
        let ducked_hh = crate::constants::DUCKED_HALF_HEIGHT as f32;
        let radius = crate::constants::PLAYER_RADIUS as f32;

        let half_height = if ducked { ducked_hh } else { standing_hh };
        let center_y = feet_y as f32 + half_height + radius;
        let translation = Vector::new(feet_x as f32, center_y, feet_z as f32);

        if let Some(body) = self.physics.bodies.get_mut(rigid_handle) {
            body.set_translation(translation, false);
        }

        if let Some(coll) = self.physics.colliders.get_mut(coll_handle) {
            let shape = if ducked {
                &self.ducked_shape
            } else {
                &self.standing_shape
            };
            coll.set_shape(shape.clone());
            coll.set_translation(translation);
        }
    }

    pub fn update_scene_queries(&mut self) {}

    /// Collider handle for the player at `index`.
    pub fn player_collider_handle(&self, index: usize) -> ColliderHandle {
        self.body_handles[index].1
    }

    /// Rigid body handle for the player at `index`.
    pub fn player_rigid_body_handle(&self, index: usize) -> RigidBodyHandle {
        self.body_handles[index].0
    }

    /// Number of player slots with bodies.
    pub fn player_count(&self) -> usize {
        self.body_handles.len()
    }

    /// Ensure the broad phase knows about all static colliders.
    /// Must be called once after all map colliders are added, before any query.
    pub fn ensure_broad_phase_ready(&mut self) {
        if !self.broad_phase_ready {
            // step() builds the broad phase tree so shapecasts work.
            // Since the only non-fixed body is our kinematic player, this
            // doesn't actually move anything — it just updates the BVH.
            self.physics.step();
            self.broad_phase_ready = true;
        }
    }
}

impl Default for SimWorld {
    fn default() -> Self {
        Self::new()
    }
}
