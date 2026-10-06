//! Supabase Storage as a [`Storage`]: a private bucket reached with the server-only key.
//!
//! Objects are named `<clinic id>/<attachment id>` (see [`StorageKey`]), so no name, phone number
//! or diagnosis ever reaches a URL, a log line or the bucket listing. Reads stay behind the
//! API's permission-checked download route: the server fetches the object and streams it, and
//! the bucket has no public or signed URL handed to a browser.

use std::fmt;
use std::time::Duration;

use reqwest::StatusCode;
use secrecy::{ExposeSecret as _, SecretString};

use super::{Storage, StorageError, StorageFuture, StorageKey};

const TIMEOUT: Duration = Duration::from_secs(30);

/// A private Supabase Storage bucket.
pub struct SupabaseStorage {
    client: reqwest::Client,
    /// `<project url>/storage/v1/object/<bucket>`, no trailing slash.
    objects_url: String,
    secret_key: SecretString,
}

impl fmt::Debug for SupabaseStorage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SupabaseStorage")
            .field("objects_url", &self.objects_url)
            .finish_non_exhaustive()
    }
}

impl SupabaseStorage {
    /// Storage in `bucket` of the project at `project_url` (`https://<ref>.supabase.co`).
    ///
    /// # Errors
    /// [`StorageError`] for a URL that isn't http(s), an empty key, a bucket name with anything
    /// but letters, digits, `-` and `_`, or an HTTP client that can't be built.
    pub fn new(
        project_url: &str,
        bucket: &str,
        secret_key: SecretString,
    ) -> Result<Self, StorageError> {
        let base = project_url.trim().trim_end_matches('/');
        if !(base.starts_with("https://") || base.starts_with("http://")) {
            return Err(StorageError("the Supabase URL must start with https://"));
        }
        if secret_key.expose_secret().trim().is_empty() {
            return Err(StorageError("the Supabase secret key is empty"));
        }
        if bucket.is_empty()
            || !bucket
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(StorageError("the bucket name is not valid"));
        }
        let client = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .build()
            .map_err(|_| StorageError("could not build the HTTP client"))?;
        Ok(Self {
            client,
            objects_url: format!("{base}/storage/v1/object/{bucket}"),
            secret_key,
        })
    }

    /// The object's URL: bucket, clinic folder, attachment id.
    fn url(&self, key: StorageKey) -> String {
        format!("{}/{}/{}", self.objects_url, key.folder(), key.name())
    }

    fn request(&self, method: reqwest::Method, key: StorageKey) -> reqwest::RequestBuilder {
        let secret = self.secret_key.expose_secret();
        self.client
            .request(method, self.url(key))
            .header("apikey", secret)
            .bearer_auth(secret)
    }
}

impl Storage for SupabaseStorage {
    fn put<'a>(&'a self, key: StorageKey, bytes: &'a [u8]) -> StorageFuture<'a, ()> {
        Box::pin(async move {
            let response = self
                .request(reqwest::Method::POST, key)
                .header("content-type", "application/octet-stream")
                .header("x-upsert", "false")
                .body(bytes.to_vec())
                .send()
                .await
                .map_err(|_| StorageError("could not reach object storage"))?;
            if response.status().is_success() {
                Ok(())
            } else {
                Err(StorageError("object storage refused the file"))
            }
        })
    }

    fn get(&self, key: StorageKey) -> StorageFuture<'_, Vec<u8>> {
        Box::pin(async move {
            let response = self
                .request(reqwest::Method::GET, key)
                .send()
                .await
                .map_err(|_| StorageError("could not reach object storage"))?;
            if !response.status().is_success() {
                return Err(StorageError("object storage has no such file"));
            }
            response
                .bytes()
                .await
                .map(|bytes| bytes.to_vec())
                .map_err(|_| StorageError("could not read the file from object storage"))
        })
    }

    fn delete(&self, key: StorageKey) -> StorageFuture<'_, ()> {
        Box::pin(async move {
            let response = self
                .request(reqwest::Method::DELETE, key)
                .send()
                .await
                .map_err(|_| StorageError("could not reach object storage"))?;
            let status = response.status();
            if status.is_success() || status == StatusCode::NOT_FOUND {
                Ok(())
            } else {
                Err(StorageError("object storage could not remove the file"))
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use aarogyam_domain::ids::{AttachmentId, ClinicId};

    use super::*;

    fn storage(url: &str, bucket: &str) -> Result<SupabaseStorage, StorageError> {
        SupabaseStorage::new(url, bucket, SecretString::from("sb_secret_x"))
    }

    #[test]
    fn urls_hold_only_bucket_clinic_and_attachment_ids() {
        let store = storage("https://abc.supabase.co/", "aarogyam-files").unwrap();
        let (clinic, file) = (ClinicId::new_v7(), AttachmentId::new_v7());
        assert_eq!(
            store.url(StorageKey::new(clinic, file)),
            format!(
                "https://abc.supabase.co/storage/v1/object/aarogyam-files/{}/{}",
                clinic.uuid(),
                file.uuid()
            )
        );
    }

    #[test]
    fn settings_are_checked() {
        assert!(storage("abc.supabase.co", "b").is_err());
        assert!(storage("https://abc.supabase.co", "").is_err());
        assert!(storage("https://abc.supabase.co", "a/b").is_err());
        assert!(
            SupabaseStorage::new("https://x.co", "b", SecretString::from(" ")).is_err(),
            "empty key"
        );
    }

    #[test]
    fn debug_hides_the_key() {
        let shown = format!("{:?}", storage("https://abc.supabase.co", "b").unwrap());
        assert!(!shown.contains("sb_secret_x"));
    }
}
