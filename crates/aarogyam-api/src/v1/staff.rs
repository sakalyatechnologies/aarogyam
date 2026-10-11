//! Staff and roles: who works at the clinic, inviting people, changing roles and access.

use aarogyam_app::staff::{self as app, ChangeMember, InviteStaff, MemberRow};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{ClinicId, MembershipId};
use aarogyam_domain::permission::require::{RolesManage, StaffManage};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::avatars::{self, Avatar};
use super::rfc3339;
use crate::AppState;
use crate::extract::{Require, RequireEither};
use crate::failure::ApiFailure;

/// A branch a member works at.
#[derive(Debug, Serialize, ToSchema)]
pub struct MemberBranch {
    /// The branch.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its name.
    pub name: String,
}

/// A member of staff.
#[derive(Debug, Serialize, ToSchema)]
pub struct Member {
    /// The membership.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The person.
    #[schema(value_type = String)]
    pub user_id: Uuid,
    /// Their name.
    pub display_name: String,
    /// Role key, such as `front_desk`.
    pub role_key: String,
    /// Role name, such as `Front desk`.
    pub role_name: String,
    /// `invited`, `active`, `suspended` or `left`.
    pub status: String,
    /// When they joined (RFC 3339).
    pub joined_at: Option<String>,
    /// Branches they work at; empty means every branch.
    pub branches: Vec<MemberBranch>,
    /// Their avatar: a preset id or a photo link (on the clinic's host, good for an hour).
    pub avatar: Option<Avatar>,
}

impl Member {
    fn new(row: MemberRow, state: &AppState, clinic: ClinicId) -> Self {
        let avatar = avatars::of(state, clinic, row.avatar_preset.clone(), row.avatar_file_id);
        Self {
            avatar,
            ..Self::from(row)
        }
    }
}

impl From<MemberRow> for Member {
    fn from(row: MemberRow) -> Self {
        Self {
            avatar: None,
            id: row.id,
            user_id: row.user_id,
            display_name: row.display_name,
            role_key: row.role_key,
            role_name: row.role_name,
            status: row.status,
            joined_at: row.joined_at.map(rfc3339),
            branches: row
                .branch_ids
                .into_iter()
                .zip(row.branch_names)
                .map(|(id, name)| MemberBranch { id, name })
                .collect(),
        }
    }
}

/// An invitation not yet accepted.
#[derive(Debug, Serialize, ToSchema)]
pub struct PendingInvitation {
    /// The invitation.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Who was invited.
    pub email: Option<String>,
    /// The role they will get.
    pub role_key: String,
    /// When it was sent (RFC 3339).
    pub created_at: String,
    /// When it expires (RFC 3339).
    pub expires_at: String,
}

/// The clinic's staff.
#[derive(Debug, Serialize, ToSchema)]
pub struct Staff {
    /// Members, active first, then by name.
    pub members: Vec<Member>,
    /// Invitations neither accepted nor expired, newest first.
    pub invitations: Vec<PendingInvitation>,
}

/// The clinic's members, with their roles, status and branches, and pending invitations.
#[utoipa::path(
    get,
    path = "/api/v1/staff",
    operation_id = "listStaff",
    tag = "staff",
    security(("bearer" = [])),
    responses(
        (status = 200, body = Staff),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks staff.manage"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<StaffManage>,
) -> Result<Json<Staff>, ApiFailure> {
    let staff = app::list(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(Staff {
        members: staff
            .members
            .into_iter()
            .map(|row| Member::new(row, &state, request.actor.clinic_id))
            .collect(),
        invitations: staff
            .invitations
            .into_iter()
            .map(|row| PendingInvitation {
                id: row.id,
                email: row.email,
                role_key: row.role_key,
                created_at: rfc3339(row.created_at),
                expires_at: rfc3339(row.expires_at),
            })
            .collect(),
    }))
}

/// Someone to invite.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewInvitation {
    /// Their email; they sign in with it to accept.
    pub email: String,
    /// The role they will get, such as `doctor`.
    pub role_key: String,
}

/// An invitation just sent. `invite_token` is shown once; only its hash is stored.
#[derive(Debug, Serialize, ToSchema)]
pub struct CreatedInvitation {
    /// The invitation.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Who was invited.
    pub email: String,
    /// The role they will get.
    pub role_key: String,
    /// When it expires (RFC 3339).
    pub expires_at: String,
    /// The secret for the invitation link (`https://<clinic host>/invite#<token>`), also
    /// emailed to the invitee.
    pub invite_token: String,
}

/// Invites someone to the staff and emails them the link (through the outbox). Only owners
/// may invite owners.
#[utoipa::path(
    post,
    path = "/api/v1/staff/invitations",
    operation_id = "inviteStaff",
    tag = "staff",
    request_body = NewInvitation,
    security(("bearer" = [])),
    responses(
        (status = 201, body = CreatedInvitation),
        (status = 400, description = "Invalid email or unknown role"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks staff.manage, or a non-owner invited an owner"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn invite(
    State(state): State<AppState>,
    Require { request, .. }: Require<StaffManage>,
    ApiJson(body): ApiJson<NewInvitation>,
) -> Result<(StatusCode, Json<CreatedInvitation>), ApiFailure> {
    let invited = app::invite(
        state.db(),
        &request.actor,
        request.request_id,
        InviteStaff {
            email: body.email,
            role_key: body.role_key,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = Event::StaffInvited.as_str(),
        invitation_id = %invited.id.uuid(),
        role_key = %invited.role_key,
        "staff invited"
    );
    Ok((
        StatusCode::CREATED,
        Json(CreatedInvitation {
            id: invited.id.uuid(),
            email: invited.email,
            role_key: invited.role_key,
            expires_at: rfc3339(invited.expires_at),
            invite_token: invited.token,
        }),
    ))
}

/// A change to a member. Fields left out stay as they are.
#[derive(Debug, Deserialize, ToSchema)]
pub struct MemberChanges {
    /// The new role key.
    pub role_key: Option<String>,
    /// `active` (reactivate), `suspended` or `left`.
    pub status: Option<String>,
}

/// Changes a member's role or status. Takes effect on the member's next request. Nobody
/// changes their own role, only owners make or change owners, and the last active owner
/// can't be suspended, removed or demoted.
#[utoipa::path(
    patch,
    path = "/api/v1/staff/{membership_id}",
    operation_id = "updateStaffMember",
    tag = "staff",
    params(("membership_id" = String, Path, description = "The membership")),
    request_body = MemberChanges,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Member),
        (status = 400, description = "Unknown role or status"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks staff.manage, or only an owner may do this"),
        (status = 404, description = "No such member in this clinic"),
        (status = 409, description = "Your own role, or the last active owner")
    )
)]
pub(crate) async fn change(
    State(state): State<AppState>,
    Require { request, .. }: Require<StaffManage>,
    ApiPath(membership_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<MemberChanges>,
) -> Result<Json<Member>, ApiFailure> {
    let membership_id = MembershipId::from_uuid(membership_id);
    let member = app::change(
        state.db(),
        &request.actor,
        request.request_id,
        membership_id,
        ChangeMember {
            role_key: body.role_key,
            status: body.status,
        },
    )
    .await?;
    state.forget_membership(request.actor.clinic_id, membership_id);
    tracing::info!(
        event = Event::MembershipChanged.as_str(),
        membership_id = %member.id,
        role_key = %member.role_key,
        status = %member.status,
        "membership changed"
    );
    Ok(Json(Member::new(member, &state, request.actor.clinic_id)))
}

/// A permission a role holds.
#[derive(Debug, Serialize, ToSchema)]
pub struct RolePermission {
    /// Permission key, such as `patients.read`.
    pub key: String,
    /// `all`, `own` or `assigned`.
    pub scope: String,
}

/// A role.
#[derive(Debug, Serialize, ToSchema)]
pub struct Role {
    /// The role.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Key, such as `doctor`.
    pub key: String,
    /// Name, such as `Doctor`.
    pub name: String,
    /// What it is for.
    pub description: Option<String>,
    /// Whether it is one of the standard roles.
    pub is_template: bool,
    /// What it may do.
    pub permissions: Vec<RolePermission>,
    /// Members who have it (invited, active or suspended).
    pub member_count: i64,
}

/// The clinic's roles.
#[derive(Debug, Serialize, ToSchema)]
pub struct Roles {
    /// Standard roles first, then by name.
    pub items: Vec<Role>,
}

/// The clinic's roles and the permissions each holds, for choosing a role.
#[utoipa::path(
    get,
    path = "/api/v1/roles",
    operation_id = "listRoles",
    tag = "staff",
    security(("bearer" = [])),
    responses(
        (status = 200, body = Roles),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks staff.manage and roles.manage"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn roles(
    State(state): State<AppState>,
    RequireEither { request, .. }: RequireEither<StaffManage, RolesManage>,
) -> Result<Json<Roles>, ApiFailure> {
    let rows = app::roles(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(Roles {
        items: rows
            .into_iter()
            .map(|row| Role {
                id: row.id,
                key: row.key,
                name: row.name,
                description: row.description,
                is_template: row.is_template,
                permissions: row
                    .permissions
                    .into_iter()
                    .zip(row.scopes)
                    .map(|(key, scope)| RolePermission { key, scope })
                    .collect(),
                member_count: row.members,
            })
            .collect(),
    }))
}
