use std::time::Instant;

use crate::{Context, Error};

/// Get the websocket heartbeat and roundtrip latency.
#[poise::command(slash_command, guild_only)]
pub async fn ping(ctx: Context<'_>) -> Result<(), Error> {
    let start = Instant::now();
    ctx.defer().await?;
    let roundtrip = start.elapsed().as_millis();
    let heartbeat = ctx.ping().await.as_millis();

    ctx.say(format!(
        "Pong! Roundtrip took: {roundtrip}ms. Heartbeat: {heartbeat}ms."
    ))
    .await?;

    Ok(())
}
