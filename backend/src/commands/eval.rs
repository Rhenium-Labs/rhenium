use std::time::Instant;

use poise::serenity_prelude::{CreateActionRow, CreateButton};
use rhai::{Dynamic, Engine, Scope};

use crate::{Context, Error};

/// Developer-only command: evaluate code at runtime.
///
#[poise::command(
    prefix_command,
    hide_in_help,
    aliases("e", "ev", "evaluate", "exec", "run")
)]
pub async fn eval(ctx: Context<'_>, #[rest] input: Option<String>) -> Result<(), Error> {
    let data = ctx.data();

    // Keep TS behavior: silently ignore non-developers.
    if !data
        .global_config
        .is_developer(&ctx.author().id.to_string())
    {
        return Ok(());
    }

    let Some(input) = input else {
        ctx.say("You must provide a string of code to evaluate.")
            .await?;
        return Ok(());
    };

    let parsed = parse_eval_input(&input);
    if parsed.code.trim().is_empty() {
        ctx.say("You must provide a string of code to evaluate.")
            .await?;
        return Ok(());
    }

    let start = Instant::now();
    let (is_error, output, return_type) = {
        let engine = Engine::new();
        let mut scope = Scope::new();
        scope.push("author_id", ctx.author().id.to_string());
        if let Some(guild_id) = ctx.guild_id() {
            scope.push("guild_id", guild_id.to_string());
        }

        match engine.eval_with_scope::<Dynamic>(&mut scope, &parsed.code) {
            Ok(value) => (
                false,
                format_dynamic(&value, parsed.depth),
                value.type_name().to_string(),
            ),
            Err(err) => (true, err.to_string(), "error".to_string()),
        }
    };
    let elapsed = start.elapsed();

    if parsed.silent {
        return Ok(());
    }

    if output.len() > 1900 {
        if let Some(url) = crate::utils::hastebin(&output, "js").await {
            let mut reply = poise::CreateReply::default().content(format!(
                "**Return Type:** `{}`\n**Time Taken:** `{}`",
                return_type,
                format_execution_time(elapsed)
            ));
            let row =
                CreateActionRow::Buttons(vec![CreateButton::new_link(url).label("View Output")]);
            reply = reply.components(vec![row]);
            ctx.send(reply).await?;
            return Ok(());
        }

        ctx.say("Output too large and failed to upload to hastebin.")
            .await?;
        return Ok(());
    }

    let header = if is_error { "**Error**" } else { "**Output**" };
    let type_info = if is_error {
        String::new()
    } else {
        format!("\n**Return Type:** `{}`", return_type)
    };
    let content = format!(
        "{}\n```ts\n{}\n```{}\n**Time Taken:** `{}`",
        header,
        output,
        type_info,
        format_execution_time(elapsed)
    );

    ctx.say(content).await?;
    Ok(())
}

#[derive(Default)]
struct ParsedEvalInput {
    depth: usize,
    silent: bool,
    #[allow(dead_code)]
    async_mode: bool,
    code: String,
}

fn parse_eval_input(input: &str) -> ParsedEvalInput {
    let tokens: Vec<&str> = input.split_whitespace().collect();
    let mut parsed = ParsedEvalInput {
        depth: 0,
        silent: false,
        async_mode: false,
        code: String::new(),
    };

    let mut idx = 0usize;
    while idx < tokens.len() {
        let token = tokens[idx];
        match token {
            "--async" | "-a" | "async" => {
                parsed.async_mode = true;
                idx += 1;
            }
            "--silent" | "-s" | "silent" => {
                parsed.silent = true;
                idx += 1;
            }
            "--depth" | "-d" | "depth" => {
                if idx + 1 < tokens.len() {
                    if let Ok(depth) = tokens[idx + 1].parse::<usize>() {
                        parsed.depth = depth;
                    }
                    idx += 2;
                } else {
                    idx += 1;
                }
            }
            _ if token.starts_with("--depth=") => {
                if let Some(value) = token.split_once('=').map(|(_, rhs)| rhs) {
                    if let Ok(depth) = value.parse::<usize>() {
                        parsed.depth = depth;
                    }
                }
                idx += 1;
            }
            _ => break,
        }
    }

    if idx < tokens.len() {
        parsed.code = tokens[idx..].join(" ");
    }

    parsed
}

fn format_dynamic(value: &Dynamic, depth: usize) -> String {
    if let Some(text) = value.clone().try_cast::<String>() {
        return text;
    }

    if depth > 0 {
        return format!("{value:#?}");
    }

    format!("{value:?}")
}

fn format_execution_time(duration: std::time::Duration) -> String {
    let millis = duration.as_secs_f64() * 1000.0;
    if millis < 1.0 {
        format!("{} microseconds", (millis / 1e-2).round() as u64)
    } else {
        crate::utils::format_duration_ms(millis.round() as u64)
    }
}
