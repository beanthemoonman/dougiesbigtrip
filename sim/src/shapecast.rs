/// Shapecast wrappers for Rapier3D — the only place Rapier is used for collision
/// queries. See docs/source-movement.md: the accel/friction curve and the
/// collide-and-slide loop live in movement.rs by hand; this module just wraps
/// Rapier's shape-cast/ray-cast/overlap queries.
///
/// All coordinates use f64 for consistency with the sim's movement math;
/// conversion to f32 for Rapier happens at this boundary.
use rapier3d::parry::query::details::ShapeCastOptions;
use rapier3d::prelude::*;

/// If a swept shape ends up closer than this to a surface, Rapier reports a hit
/// rather than requiring exact penetration. Not a ported Source value.
const TARGET_DISTANCE: f32 = 0.005;

/// Sweeps a shape from `origin` (world-space) by `displacement` metres against
/// everything in `physics` except `exclude_collider`. Returns the impact fraction
/// in [0, 1], or None on no hit, and writes the world-space hit normal into
/// `out_normal`.
pub fn capsule_cast(
    physics: &PhysicsWorld,
    shape: &dyn Shape,
    origin_x: f64, origin_y: f64, origin_z: f64,
    disp_x: f64, disp_y: f64, disp_z: f64,
    out_normal: &mut nalgebra::Vector3<f64>,
    exclude_collider: ColliderHandle,
    stop_at_penetration: bool,
) -> Option<f64> {
    let disp_sq = (disp_x * disp_x + disp_y * disp_y + disp_z * disp_z) as f32;
    if disp_sq == 0.0 {
        return None;
    }

    let shape_pos = Pose::from_parts(
        Vector::new(origin_x as f32, origin_y as f32, origin_z as f32),
        Rotation::IDENTITY,
    );
    let shape_vel = Vector::new(disp_x as f32, disp_y as f32, disp_z as f32);

    let options = ShapeCastOptions {
        target_distance: TARGET_DISTANCE,
        stop_at_penetration,
        max_time_of_impact: 1.0,
        compute_impact_geometry_on_penetration: true,
    };

    let filter = QueryFilter::default().exclude_collider(exclude_collider);

    let hit = physics.cast_shape(&shape_pos, shape_vel, shape, options, filter);
    match hit {
        Some((_collider_handle, shape_cast_hit)) => {
            out_normal.x = shape_cast_hit.normal1.x as f64;
            out_normal.y = shape_cast_hit.normal1.y as f64;
            out_normal.z = shape_cast_hit.normal1.z as f64;
            Some(shape_cast_hit.time_of_impact as f64)
        }
        None => None,
    }
}

/// True if a shape at `center` overlaps anything in `physics` (except `exclude_collider`).
pub fn capsule_overlaps_anything(
    physics: &PhysicsWorld,
    shape: &dyn Shape,
    center_x: f64, center_y: f64, center_z: f64,
    exclude_collider: ColliderHandle,
) -> bool {
    let shape_pos = Pose::from_parts(
        Vector::new(center_x as f32, center_y as f32, center_z as f32),
        Rotation::IDENTITY,
    );
    let filter = QueryFilter::default().exclude_collider(exclude_collider);

    physics.intersect_shape(shape_pos, shape, filter).next().is_some()
}

/// Traces a ray from `origin` along the unit vector `direction`, up to `max_distance`
/// metres. Returns the distance to the impact and writes the surface normal into
/// `out_normal`, or None if the ray hits nothing.
pub fn ray_cast(
    physics: &PhysicsWorld,
    origin_x: f64, origin_y: f64, origin_z: f64,
    dir_x: f64, dir_y: f64, dir_z: f64,
    max_distance: f64,
    out_normal: &mut nalgebra::Vector3<f64>,
    exclude_collider: ColliderHandle,
) -> Option<f64> {
    let ray = Ray::new(
        Vector::new(origin_x as f32, origin_y as f32, origin_z as f32),
        Vector::new(dir_x as f32, dir_y as f32, dir_z as f32),
    );
    let filter = QueryFilter::default().exclude_collider(exclude_collider);
    let hit = physics.cast_ray_and_get_normal(&ray, max_distance as f32, true, filter);
    match hit {
        Some((_collider_handle, intersection)) => {
            out_normal.x = intersection.normal.x as f64;
            out_normal.y = intersection.normal.y as f64;
            out_normal.z = intersection.normal.z as f64;
            Some(intersection.time_of_impact as f64)
        }
        None => None,
    }
}
