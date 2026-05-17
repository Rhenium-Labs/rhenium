use tracing::error;

use crate::{Data, Error};

/// Global error handler for poise framework errors.
pub async fn on_error(error: poise::FrameworkError<'_, Data, Error>) -> Result<(), Error> {
    match error {
        poise::FrameworkError::Command { error, ctx, .. } => {
            let sentry_id = sentry::capture_error(&*error);
            error!("Error in command '{}': {error:?}", ctx.command().name);

            let content = format!(
                "An error occurred while executing this command. \
                 Please use this ID when reporting the bug: `{sentry_id}`."
            );

            ctx.say(content).await?;
        }

        poise::FrameworkError::CommandCheckFailed { error, ctx, .. } => {
            if let Some(e) = error {
                error!("Command check failed for '{}': {e}", ctx.command().name);
            }
        }

        poise::FrameworkError::ArgumentParse { error, ctx, .. } => {
            ctx.say(format!("Invalid argument: {error}")).await?;
        }

        poise::FrameworkError::MissingBotPermissions {
            missing_permissions,
            ctx,
            ..
        } => {
            ctx.say(format!(
                "I'm missing the following permissions: {missing_permissions}"
            ))
            .await?;
        }

        poise::FrameworkError::MissingUserPermissions {
            missing_permissions,
            ctx,
            ..
        } => {
            if let Some(perms) = missing_permissions {
                ctx.say(format!("You're missing permissions: {perms}"))
                    .await?;
            }
        }

        other => {
            poise::builtins::on_error(other).await?;
        }
    }

    Ok(())
}
