use poise::serenity_prelude::{self as serenity, ButtonStyle, CreateActionRow, CreateButton, CreateEmbed};
use sea_orm::{ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, Statement, TryGetable};
use sea_orm::sea_query::OnConflict;

use crate::lib::config::guild::GuildConfig;
use crate::lib::config::schema::RawGuildConfig;
use crate::{Context, Data, Error};

/// Send an ephemeral red-embed error response, matching the TS `{ error: "..." }` pattern.
async fn reply_error(ctx: Context<'_>, message: impl Into<String>) -> Result<(), Error> {
    let embed = CreateEmbed::new()
        .description(message.into())
        .color(0xED4245); // Colors.Red
    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

/// Manage the report system.
///
#[poise::command(
    slash_command,
    guild_only,
    default_member_permissions = "MODERATE_MEMBERS",
    subcommands("blacklist", "unblacklist", "search", "leaderboard"),
)]
pub async fn reports(_ctx: Context<'_>) -> Result<(), Error> {
    Ok(())
}

/// Blacklist a user from using the report system.
#[poise::command(slash_command, ephemeral)]
pub async fn blacklist(
    ctx: Context<'_>,
    #[description = "The user to blacklist"] user: serenity::User,
) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id) = ctx.guild_id() else {
        return Ok(());
    };
    let config = data
        .config_manager
        .get_guild_config(&data.db, guild_id)
        .await;
    let reports_config = match config.parse_reports_config() {
        Some(cfg) => cfg,
        None => {
            return reply_error(ctx, "Message reports have not been configured on this server.").await;
        }
    };

    if user.id == ctx.author().id {
        return reply_error(ctx, "You cannot blacklist yourself from using the report system.").await;
    }

    if reports_config
        .blacklisted_users
        .iter()
        .any(|id| id == &user.id.to_string())
    {
        return reply_error(ctx, "This user is already blacklisted from using the report system.").await;
    }

    let mut updated_config: RawGuildConfig = config.data.clone();
    updated_config
        .message_reports
        .blacklisted_users
        .push(user.id.to_string());

    persist_config(data, guild_id, &updated_config).await?;
    ctx.say(format!(
        "Successfully blacklisted {} from using the report system.",
        user.tag()
    ))
    .await?;

    Ok(())
}

/// Unblacklist a user from using the report system.
#[poise::command(slash_command, ephemeral)]
pub async fn unblacklist(
    ctx: Context<'_>,
    #[description = "The user to unblacklist"] user: serenity::User,
) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id) = ctx.guild_id() else {
        return Ok(());
    };
    let config = data
        .config_manager
        .get_guild_config(&data.db, guild_id)
        .await;
    let reports_config = match config.parse_reports_config() {
        Some(cfg) => cfg,
        None => {
            return reply_error(ctx, "Message reports have not been configured on this server.").await;
        }
    };

    if !reports_config
        .blacklisted_users
        .iter()
        .any(|id| id == &user.id.to_string())
    {
        return reply_error(ctx, "This user is not blacklisted from using the report system.").await;
    }

    let mut updated_config: RawGuildConfig = config.data.clone();
    updated_config
        .message_reports
        .blacklisted_users
        .retain(|id| id != &user.id.to_string());

    persist_config(data, guild_id, &updated_config).await?;
    ctx.say(format!(
        "Successfully unblacklisted {} from using the report system.",
        user.tag()
    ))
    .await?;

    Ok(())
}

/// Search for pending reports.
#[poise::command(slash_command, ephemeral)]
pub async fn search(
    ctx: Context<'_>,
    #[description = "Filter reports by a specific user"] target: Option<serenity::User>,
) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id) = ctx.guild_id() else {
        return Ok(());
    };
    let config = data
        .config_manager
        .get_guild_config(&data.db, guild_id)
        .await;
    if config.parse_reports_config().is_none() {
        return reply_error(ctx, "Message reports have not been configured on this server.").await;
    }

    let page = 1i64;
    let controller_id = ctx.author().id.to_string();

    match build_search_page(
        ctx.serenity_context(),
        data,
        &config,
        guild_id,
        target.as_ref(),
        page,
        &controller_id,
    )
    .await
    {
        Ok((embed, components)) => {
            ctx.send(
                poise::CreateReply::default()
                    .embed(embed)
                    .components(components),
            )
            .await?;
        }
        Err(message) => {
            ctx.say(message).await?;
        }
    }

    Ok(())
}

/// Builds the search page embed and pagination components.
/// Shared by `/reports search` and report-search pagination buttons.
pub async fn build_search_page(
    ctx: &serenity::Context,
    data: &Data,
    config: &GuildConfig,
    guild_id_obj: serenity::GuildId,
    target: Option<&serenity::User>,
    page: i64,
    controller_id: &str,
) -> Result<(CreateEmbed, Vec<CreateActionRow>), String> {
    let guild_id = guild_id_obj.to_string();
    let page = page.max(1);
    let offset = (page - 1) * 5;

    use crate::lib::entities::message_report::{Column as MRCol, Entity as MREntity, ReportStatus};

    let mut base_query = MREntity::find()
        .filter(MRCol::GuildId.eq(guild_id.clone()))
        .filter(MRCol::Status.eq(ReportStatus::Pending));
    if let Some(target) = target {
        base_query = base_query.filter(MRCol::AuthorId.eq(target.id.to_string()));
    }

    let total_count = base_query
        .clone()
        .count(&data.db)
        .await
        .map_err(|_| "Failed to fetch reports.".to_string())? as i64;

    let reports = base_query
        .order_by_desc(MRCol::ReportedAt)
        .limit(5)
        .offset(offset as u64)
        .all(&data.db)
        .await
        .map_err(|_| "Failed to fetch reports.".to_string())?;

    if reports.is_empty() {
        return Err("No message reports found.".to_string());
    }

    let mut fields: Vec<(String, String, bool)> = Vec::new();
    let webhook_channel = config.data.message_reports.webhook_channel.clone();

    for report in &reports {
        let id = report.id.clone();
        let author_id = report.author_id.clone();
        let reason = report.report_reason.clone();
        let timestamp = report.reported_at.and_utc().timestamp();
        let field_name = if target.is_some() {
            format!("#{id}")
        } else {
            let user = serenity::UserId::new(author_id.parse().unwrap_or(0))
                .to_user(ctx)
                .await
                .map(|u| u.name.clone())
                .unwrap_or_else(|_| "unknown".to_string());
            format!("#{id}, against @{user} ({author_id})")
        };

        let report_url = webhook_channel
            .as_deref()
            .map(|channel_id| format!("https://discord.com/channels/{guild_id}/{channel_id}/{id}"));
        let truncated_reason = crate::utils::messages::escape_code_block(&crate::utils::truncate(&reason, 256));
        let value = format!(
            "Created On <t:{timestamp}:f>{}\n`{truncated_reason}`",
            report_url
                .as_ref()
                .map(|url| format!(" `|` [Jump to report]({url})"))
                .unwrap_or_default()
        );
        fields.push((field_name, value, false));
    }

    let mut author = if let Some(target) = target {
        serenity::CreateEmbedAuthor::new(format!("Pending Message Reports for @{}", target.name))
    } else {
        serenity::CreateEmbedAuthor::new("Pending Message Reports")
    };
    if let Some(target) = target {
        author = author.icon_url(target.face());
    } else if let Some(guild_icon) = guild_id_obj
        .to_partial_guild(ctx)
        .await
        .ok()
        .and_then(|g| g.icon_url())
    {
        author = author.icon_url(guild_icon);
    }

    let mut embed = CreateEmbed::new()
        .color(0x23272a) // Colors.NotQuiteBlack
        .author(author)
        .fields(fields)
        .timestamp(serenity::Timestamp::now());

    if let Some(target) = target {
        embed = embed.footer(serenity::CreateEmbedFooter::new(format!("User ID: {}", target.id)));
    }

    let total_pages = ((total_count as f64) / 5.0).ceil().max(1.0) as i64;
    let is_first_page = page <= 1;
    let is_last_page = page >= total_pages;
    let components = if total_count > 5 {
        if total_pages > 2 {
            vec![CreateActionRow::Buttons(vec![
                CreateButton::new(format!("report-search-first-{controller_id}"))
                    .label("«")
                    .style(ButtonStyle::Primary)
                    .disabled(is_first_page),
                CreateButton::new(format!("report-search-back-{controller_id}"))
                    .label("←")
                    .style(ButtonStyle::Primary)
                    .disabled(is_first_page),
                CreateButton::new("report-search-page-count")
                    .label(format!("{page} / {total_pages}"))
                    .style(ButtonStyle::Secondary)
                    .disabled(true),
                CreateButton::new(format!("report-search-next-{controller_id}"))
                    .label("→")
                    .style(ButtonStyle::Primary)
                    .disabled(is_last_page),
                CreateButton::new(format!("report-search-last-{controller_id}"))
                    .label("»")
                    .style(ButtonStyle::Primary)
                    .disabled(is_last_page),
            ])]
        } else {
            vec![CreateActionRow::Buttons(vec![
                CreateButton::new(format!("report-search-back-{controller_id}"))
                    .label("←")
                    .style(ButtonStyle::Primary)
                    .disabled(is_first_page),
                CreateButton::new("report-search-page-count")
                    .label(format!("{page} / {total_pages}"))
                    .style(ButtonStyle::Secondary)
                    .disabled(true),
                CreateButton::new(format!("report-search-next-{controller_id}"))
                    .label("→")
                    .style(ButtonStyle::Primary)
                    .disabled(is_last_page),
            ])]
        }
    } else {
        Vec::new()
    };

    Ok((embed, components))
}

/// View report system leaderboard.
#[poise::command(slash_command, ephemeral)]
pub async fn leaderboard(
    ctx: Context<'_>,
    #[description = "The query method"] query: ReportSortMethod,
) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let config = data
        .config_manager
        .get_guild_config(&data.db, guild_id_obj)
        .await;
    if config.parse_reports_config().is_none() {
        return reply_error(ctx, "Message reports have not been configured on this server.").await;
    }

    let (group_by_column, title, status_filter) = match query {
        ReportSortMethod::Accuracy => ("reported_by", "Most Accurate Reporters", Some("Resolved")),
        ReportSortMethod::Activity => ("reported_by", "Most Active Reporters", None),
        ReportSortMethod::Reported => ("author_id", "Most Reported Users", None),
    };

    let sql = if status_filter.is_some() {
        format!(
            r#"SELECT {group_by_column} as user_id, COUNT(*) as report_count
               FROM "MessageReport"
               WHERE guild_id = $1 AND status = $2::"ReportStatus"
               GROUP BY {group_by_column}
               ORDER BY report_count DESC
               LIMIT 5"#
        )
    } else {
        format!(
            r#"SELECT {group_by_column} as user_id, COUNT(*) as report_count
               FROM "MessageReport"
               WHERE guild_id = $1
               GROUP BY {group_by_column}
               ORDER BY report_count DESC
               LIMIT 5"#
        )
    };

    let stmt = if let Some(status) = status_filter {
        Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            &sql,
            [guild_id.clone().into(), status.into()],
        )
    } else {
        Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            &sql,
            [guild_id.clone().into()],
        )
    };
    let rows = data.db.query_all(stmt).await?;

    if rows.is_empty() {
        let error_embed = CreateEmbed::new()
            .description(format!(
                "There is no sufficient data to display the {}.",
                title.to_lowercase()
            ))
            .color(0xED4245); // Colors.Red
        ctx.send(poise::CreateReply::default().embed(error_embed)).await?;
        return Ok(());
    }

    let mut lines = Vec::new();
    for (i, row) in rows.iter().enumerate() {
        let user_id: String = String::try_get_by(row, "user_id").unwrap_or_default();
        let count: i64 = i64::try_get_by(row, "report_count").unwrap_or(0);
        lines.push(format!(
            "{}. <@{user_id}> (`{user_id}`) — **{count}** {}",
            i + 1,
            crate::utils::inflect(count as u64, "report")
        ));
    }

    let guild = guild_id_obj.to_partial_guild(ctx.serenity_context()).await.ok();
    let author_name = guild
        .as_ref()
        .map(|g| format!("{} - {}", g.name, title))
        .unwrap_or_else(|| title.to_string());
    let mut author = serenity::CreateEmbedAuthor::new(author_name);
    if let Some(icon_url) = guild.and_then(|g| g.icon_url()) {
        author = author.icon_url(icon_url);
    }

    let embed = CreateEmbed::new()
        .color(0x23272a) // Colors.NotQuiteBlack
        .author(author)
        .description(lines.join("\n"))
        .timestamp(serenity::Timestamp::now());

    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

#[derive(Debug, Clone, Copy, poise::ChoiceParameter)]
pub enum ReportSortMethod {
    #[name = "Most Accurate Reporter"]
    Accuracy,
    #[name = "Most Active Reporter"]
    Activity,
    #[name = "Most Reported Users"]
    Reported,
}

async fn persist_config(
    data: &Data,
    guild_id: serenity::GuildId,
    config: &RawGuildConfig,
) -> Result<(), Error> {
    let config_json = serde_json::to_value(config)?;
    let model = crate::lib::entities::guild::ActiveModel {
        id: Set(guild_id.to_string()),
        config: Set(config_json),
    };
    crate::lib::entities::guild::Entity::insert(model)
        .on_conflict(
            OnConflict::column(crate::lib::entities::guild::Column::Id)
                .update_column(crate::lib::entities::guild::Column::Config)
                .to_owned(),
        )
        .exec(&data.db)
        .await?;
    data.config_manager.reload(&data.db, guild_id).await;
    Ok(())
}
