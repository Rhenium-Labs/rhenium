use sea_orm::entity::prelude::*;

use crate::lib::content_filter::types::{ContentFilterStatus, Detector};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "ContentFilterAlert")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub guild_id: String,
    pub message_id: String,
    pub channel_id: String,
    pub alert_message_id: String,
    pub alert_channel_id: String,
    pub offender_id: String,
    pub detectors: Vec<Detector>,
    pub highest_score: f64,
    pub mod_status: ContentFilterStatus,
    pub del_status: ContentFilterStatus,
    pub created_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
