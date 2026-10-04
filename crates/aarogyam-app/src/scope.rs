//! The clinic transaction scope for a member's request.

use aarogyam_domain::access::ClinicActor;
use sakalya_db::{ActorKind, Scope};
use uuid::Uuid;

// Evaluated at compile time: a bad literal fails the build, never a request.
pub(crate) const STAFF: ActorKind = match ActorKind::new("staff") {
    Ok(kind) => kind,
    Err(_) => panic!("invalid actor kind"),
};

/// The scope for a member acting in their clinic: row-level security limits every query to
/// the clinic, and the change history records the member and the request.
pub(crate) fn staff_scope(actor: &ClinicActor, request_id: Option<Uuid>) -> Scope {
    let scope = Scope::tenant(actor.clinic_id.uuid())
        .with_user(actor.user_id.uuid())
        .with_actor_kind(STAFF);
    match request_id {
        Some(id) => scope.with_request_id(id),
        None => scope,
    }
}

pub(crate) const PATIENT: ActorKind = match ActorKind::new("patient") {
    Ok(kind) => kind,
    Err(_) => panic!("invalid actor kind"),
};

/// The scope for someone outside the clinic opening a public link on its host (a patient with
/// a link, or anyone scanning a QR code): the clinic only, with no user.
pub(crate) fn public_scope(
    clinic_id: aarogyam_domain::ids::ClinicId,
    request_id: Option<Uuid>,
) -> Scope {
    let scope = Scope::tenant(clinic_id.uuid()).with_actor_kind(PATIENT);
    match request_id {
        Some(id) => scope.with_request_id(id),
        None => scope,
    }
}
