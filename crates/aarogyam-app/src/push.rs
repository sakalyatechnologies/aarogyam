//! Who a staff notification is pushed to: exactly the members who would see it in their own
//! `GET /notifications` feed. The rules are the feed's: each active member's role becomes a
//! [`Viewer`](aarogyam_dal::notifications::Viewer) the way the feed builds it
//! (`notifications::viewer`), and the feed's own predicates (`dal::visible_among`) are asked
//! about the notifications, inside the member's clinic scope. Suspended and left members and
//! disabled users never appear. An escalation goes to the owners among them.

use std::collections::HashMap;

use aarogyam_dal::devices::{self as devices_dal, Device};
use aarogyam_dal::lookups;
use aarogyam_dal::notifications as dal;
use aarogyam_domain::access::{ClinicActor, ClinicPlace};
use aarogyam_domain::ids::{ClinicId, MembershipId, UserId};
use aarogyam_domain::notification::{Audience, addressed_to};
use sakalya_db::{Db, DbError};
use uuid::Uuid;

use crate::notifications::viewer;
use crate::scope::staff_scope;

/// A member and which of the asked-about notifications they see.
#[derive(Debug, Clone)]
pub struct Seeing {
    /// The member.
    pub membership_id: MembershipId,
    /// The person.
    pub user_id: UserId,
    /// The notifications (from those asked about) in their feed.
    pub seen: Vec<Uuid>,
}

/// The active members of `clinic` addressed by `audience` who see at least one of the
/// notifications `ids` in their feed.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn seeing(
    db: &Db,
    clinic: ClinicId,
    ids: &[Uuid],
    audience: Audience,
) -> Result<Vec<Seeing>, DbError> {
    // Only the permissions and the role matter here; the clinic's clock and numbering do not.
    let place = ClinicPlace {
        id: clinic,
        timezone: String::new(),
        number_prefix: String::new(),
    };
    let mut people = Vec::new();
    for authorization in lookups::active_members(db.pool(), clinic).await? {
        let Ok(actor) = ClinicActor::admit(place.clone(), authorization) else {
            continue;
        };
        if !addressed_to(audience, &actor.role_key) {
            continue;
        }
        let Some(viewer) = viewer(&actor) else {
            continue;
        };
        let seen = db
            .scoped(&staff_scope(&actor, None), async |tx| {
                dal::visible_among(tx.conn(), viewer, ids).await
            })
            .await?;
        if !seen.is_empty() {
            people.push(Seeing {
                membership_id: actor.membership_id,
                user_id: actor.user_id,
                seen,
            });
        }
    }
    Ok(people)
}

/// The devices each notification is pushed to: the staff-app devices of the members who see it,
/// leaving out devices registered by a revoked session. Notifications nobody can be pushed to
/// are absent.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn recipients(
    db: &Db,
    clinic: ClinicId,
    ids: &[Uuid],
    audience: Audience,
) -> Result<HashMap<Uuid, Vec<Device>>, DbError> {
    let people = seeing(db, clinic, ids, audience).await?;
    let users: Vec<Uuid> = people.iter().map(|person| person.user_id.uuid()).collect();
    if users.is_empty() {
        return Ok(HashMap::new());
    }
    let devices = devices_dal::push_devices(db.pool(), &users).await?;
    let mut by_notification: HashMap<Uuid, Vec<Device>> = HashMap::new();
    for person in &people {
        for device in devices
            .iter()
            .filter(|device| device.user_id == person.user_id.uuid())
        {
            for id in &person.seen {
                by_notification.entry(*id).or_default().push(device.clone());
            }
        }
    }
    Ok(by_notification)
}
