use sqlx::PgPool;
use sqlx::Row;

pub async fn load_config(pool: &PgPool) -> Result<Option<(i32, String, i32)>, sqlx::Error> {
    let row = sqlx::query("SELECT bot_count, map, rounds_to_win FROM app.server_config WHERE id = 1")
        .fetch_optional(pool)
        .await?;
    match row {
        Some(r) => {
            let bot_count: i32 = r.get(0);
            let map: String = r.get(1);
            let rounds_to_win: i32 = r.get(2);
            Ok(Some((bot_count, map, rounds_to_win)))
        }
        None => Ok(None),
    }
}

pub async fn insert_config(
    pool: &PgPool,
    bot_count: i32,
    map: &str,
    rounds_to_win: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO app.server_config (id, bot_count, map, rounds_to_win) VALUES (1, $1, $2, $3)")
        .bind(bot_count)
        .bind(map)
        .bind(rounds_to_win)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn upsert_user(
    pool: &PgPool,
    sub: &str,
    display_name: &str,
    email: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO app.users (sub, display_name, email) VALUES ($1, $2, $3) \
         ON CONFLICT (sub) DO UPDATE SET display_name = $2, email = $3, last_seen = now()",
    )
    .bind(sub)
    .bind(display_name)
    .bind(email)
    .execute(pool)
    .await?;
    Ok(())
}
