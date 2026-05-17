use sea_orm::entity::prelude::*;

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    serde::Serialize,
    serde::Deserialize,
    EnumIter,
    DeriveActiveEnum,
)]
#[sea_orm(rs_type = "String", db_type = "Enum", enum_name = "ReportStatus")]
pub enum ReportStatus {
    #[sea_orm(string_value = "AutoResolved")]
    AutoResolved,
    #[sea_orm(string_value = "Pending")]
    Pending,
    #[sea_orm(string_value = "Disregarded")]
    Disregarded,
    #[sea_orm(string_value = "Resolved")]
    Resolved,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "MessageReport")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub guild_id: String,
    pub message_id: String,
    pub reference_id: Option<String>,
    pub message_url: String,
    pub channel_id: String,
    pub author_id: String,
    pub content: Option<String>,
    pub reported_at: DateTime,
    pub reported_by: String,
    pub report_reason: String,
    pub additional_reporters: Vec<String>,
    pub status: ReportStatus,
    pub resolved_at: Option<DateTime>,
    pub resolved_by: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
