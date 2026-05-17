use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "Message")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub guild_id: String,
    pub author_id: String,
    pub channel_id: String,
    pub sticker_id: Option<String>,
    pub reference_id: Option<String>,
    pub created_at: DateTime,
    pub content: Option<String>,
    pub attachments: Vec<String>,
    pub deleted: bool,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
