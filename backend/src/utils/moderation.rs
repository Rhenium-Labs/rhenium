use std::collections::HashMap;

use poise::serenity_prelude::{Member, Role, RoleId, UserId};

/// Result type for moderation action validation.
pub struct ModerationResult {
    pub ok: bool,
    pub message: Option<String>,
}

/// Validates a moderation action (ban, mute, etc.).
///
#[allow(clippy::too_many_arguments)]
pub fn validate_action(
    target_id: UserId,
    target_member: Option<&Member>,
    executor: &Member,
    bot_id: UserId,
    action: &str,
    guild_owner_id: Option<UserId>,
    bot_member: Option<&Member>,
    guild_roles: Option<&HashMap<RoleId, Role>>,
) -> ModerationResult {
    let action_lower = action.to_lowercase();

    if target_id == executor.user.id {
        return ModerationResult {
            ok: false,
            message: Some(format!("You cannot {action_lower} yourself.")),
        };
    }

    if target_id == bot_id {
        return ModerationResult {
            ok: false,
            message: Some(format!("You cannot {action_lower} me.")),
        };
    }

    if guild_owner_id.is_some_and(|owner_id| owner_id == target_id) {
        return ModerationResult {
            ok: false,
            message: Some(format!("You cannot {action_lower} the server owner.")),
        };
    }

    if let Some(target_member) = target_member {
        let executor_highest = highest_role_position(executor, guild_roles);
        let executor_is_owner = guild_owner_id.is_some_and(|owner_id| owner_id == executor.user.id);

        let target_highest = highest_role_position(target_member, guild_roles);

        if !executor_is_owner && target_highest >= executor_highest {
            return ModerationResult {
                ok: false,
                message: Some(format!(
                    "You cannot {action_lower} a member with higher or equal roles."
                )),
            };
        }

        if let Some(bot_member) = bot_member {
            let bot_highest = highest_role_position(bot_member, guild_roles);
            let bot_is_owner = guild_owner_id.is_some_and(|owner_id| owner_id == bot_member.user.id);

            if !bot_is_owner && target_highest >= bot_highest {
                return ModerationResult {
                    ok: false,
                    message: Some(format!(
                        "I cannot {action_lower} a member with higher or equal roles than me."
                    )),
                };
            }
        }

        if action == "Mute"
            && target_member
                .permissions
                .is_some_and(|permissions| permissions.administrator())
        {
            return ModerationResult {
                ok: false,
                message: Some(
                    "I cannot mute a member with Administrator permissions.".to_string(),
                ),
            };
        }
    }

    ModerationResult {
        ok: true,
        message: None,
    }
}

fn highest_role_position(member: &Member, guild_roles: Option<&HashMap<RoleId, Role>>) -> i64 {
    if let Some(guild_roles) = guild_roles {
        return member
            .roles
            .iter()
            .filter_map(|role_id| guild_roles.get(role_id).map(|role| role.position as i64))
            .max()
            .unwrap_or(0);
    }

    // Fallback when role metadata is unavailable.
    member
        .roles
        .iter()
        .map(|role_id| role_id.get() as i64)
        .max()
        .unwrap_or(0)
}
