//! The clinic transaction scope for a member's request.

use aarogyam_domain::access::ClinicActor;
use sakalya_db::{ActorKind, Scope};
use uuid::Uuid;

// Evaluated at compile time: a bad literal fails the build, never a request.
pub(crate) const STAFF: ActorKind = match ActorKind::new("staff") {
    Ok(kind) => kind,
    Err(_) => panic!("invalid actor kind"),
};

pub(crate) const SUPPORT: ActorKind = match ActorKind::new("support") {
    Ok(kind) => kind,
    Err(_) => panic!("invalid actor kind"),
};

/// The actor kind the change history and the access record show for `actor`: `support` for
/// Sakalya staff under a grant (the database refuses their writes), else `staff`.
pub(crate) const fn actor_kind(actor: &ClinicActor) -> ActorKind {
    if actor.support_grant.is_some() {
        SUPPORT
    } else {
        STAFF
    }
}

/// The scope for a member (or Sakalya staff under a support grant) acting in a clinic:
/// row-level security limits every query to the clinic, and the change history records the
/// person and the request.
pub(crate) fn staff_scope(actor: &ClinicActor, request_id: Option<Uuid>) -> Scope {
    let scope = Scope::tenant(actor.clinic_id.uuid())
        .with_user(actor.user_id.uuid())
        .with_actor_kind(actor_kind(actor));
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

pub(crate) const PATIENT_ACCOUNT: ActorKind = match ActorKind::new("patient_account") {
    Ok(kind) => kind,
    Err(_) => panic!("invalid actor kind"),
};

/// The scope for a signed-in patient account reading one linked clinic: row-level security
/// limits every row to the clinic and, through the `patient_account` policies, to the linked
/// record (migration 0261).
pub(crate) fn patient_account_scope(
    clinic_id: aarogyam_domain::ids::ClinicId,
    account_id: aarogyam_domain::ids::PatientAccountId,
    request_id: Option<Uuid>,
) -> Scope {
    let scope = Scope::tenant(clinic_id.uuid())
        .with_user(account_id.uuid())
        .with_actor_kind(PATIENT_ACCOUNT);
    match request_id {
        Some(id) => scope.with_request_id(id),
        None => scope,
    }
}
