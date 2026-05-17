mod content_filter_debug;
mod eval;
pub mod highlights;
mod logging;
mod ping;
mod quick_actions;
pub mod report_message_ctx;
pub mod reports;
mod request_action;
mod stats;
mod whitelist;

use crate::{Data, Error};

/// Returns all registered poise commands.
pub fn all_commands() -> Vec<poise::Command<Data, Error>> {
    vec![
        // Slash commands.
        ping::ping(),
        highlights::highlights(),
        reports::reports(),
        request_action::request(),
        quick_actions::quick(),
        logging::logging(),
        // Context menu commands.
        report_message_ctx::report_message(),
        // Developer-only prefix commands.
        stats::stats(),
        whitelist::whitelist(),
        content_filter_debug::content_filter_debug(),
        eval::eval(),
    ]
}
