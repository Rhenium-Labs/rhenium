use sea_orm::entity::prelude::*;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq,
    serde::Serialize, serde::Deserialize,
    EnumIter, DeriveActiveEnum,
)]
#[sea_orm(rs_type = "String", db_type = "Enum", enum_name = "RequestStatus")]
pub enum RequestStatus {
    #[sea_orm(string_value = "AutoResolved")]
    AutoResolved,
    #[sea_orm(string_value = "Pending")]
    Pending,
    #[sea_orm(string_value = "Disregarded")]
    Disregarded,
    #[sea_orm(string_value = "Accepted")]
    Accepted,
    #[sea_orm(string_value = "Denied")]
    Denied,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "BanRequest")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub guild_id: String,
    pub target_id: String,
    pub target_muted_automatically: bool,
    pub status: RequestStatus,
    pub resolved_at: Option<DateTime>,
    pub resolved_by: Option<String>,
    pub requested_at: DateTime,
    pub requested_by: String,
    pub expires_at: Option<DateTime>,
    pub reason: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
