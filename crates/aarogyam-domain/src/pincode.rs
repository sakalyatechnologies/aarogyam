//! Offline India PIN code lookup.
//!
//! The data is India Post's All India Pincode Directory, reduced by `scripts/gen-pincodes.py`
//! (see `data/PINCODES.md`). It is embedded gzipped, decompressed and parsed once on first use.

use std::collections::HashMap;
use std::io::Read;
use std::sync::OnceLock;

use flate2::read::GzDecoder;

static DATA: &[u8] = include_bytes!("../data/pincodes.tsv.gz");

/// A PIN code that cannot be looked up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum PincodeError {
    /// The PIN code is not six digits.
    #[error("pincode must be six digits, not starting with 0")]
    Invalid,
}

/// Where a PIN code is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PincodeInfo {
    /// The six-digit PIN code.
    pub pin: String,
    /// The district, title-cased.
    pub district: String,
    /// The state or union territory, title-cased.
    pub state: String,
}

fn table() -> &'static HashMap<u32, (String, String)> {
    static TABLE: OnceLock<HashMap<u32, (String, String)>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut text = String::new();
        // The bytes are embedded at build time; a failure here is a broken build, not input.
        if GzDecoder::new(DATA).read_to_string(&mut text).is_err() {
            return HashMap::new();
        }
        text.lines()
            .filter_map(|line| {
                let mut f = line.splitn(3, '\t');
                let pin = f.next()?.parse::<u32>().ok()?;
                Some((pin, (f.next()?.to_owned(), f.next()?.to_owned())))
            })
            .collect()
    })
}

/// Looks a PIN code up. `Ok(None)` means the PIN is well formed but not in the directory.
///
/// # Errors
/// [`PincodeError::Invalid`] when `pin` is not six digits or starts with 0.
pub fn lookup(pin: &str) -> Result<Option<PincodeInfo>, PincodeError> {
    let bytes = pin.as_bytes();
    if bytes.len() != 6 || bytes[0] == b'0' || !bytes.iter().all(u8::is_ascii_digit) {
        return Err(PincodeError::Invalid);
    }
    let key = pin.parse::<u32>().map_err(|_| PincodeError::Invalid)?;
    Ok(table().get(&key).map(|(district, state)| PincodeInfo {
        pin: pin.to_owned(),
        district: district.clone(),
        state: state.clone(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(pin: &str) -> PincodeInfo {
        lookup(pin).unwrap().unwrap()
    }

    #[test]
    fn known_pins() {
        let d = info("110001");
        assert_eq!(
            (d.district.as_str(), d.state.as_str()),
            ("New Delhi", "Delhi")
        );
        let m = info("400001");
        assert_eq!(
            (m.district.as_str(), m.state.as_str()),
            ("Mumbai", "Maharashtra")
        );
        let b = info("560001");
        assert!(b.district.starts_with("Bengaluru") || b.district.starts_with("Bangalore"));
        assert_eq!(b.state, "Karnataka");
    }

    #[test]
    fn unknown_pin_is_none() {
        assert_eq!(lookup("999999"), Ok(None));
    }

    #[test]
    fn bad_input_is_an_error() {
        for bad in ["", "11000", "1100011", "011001", "11000a", "１１０００１"] {
            assert_eq!(lookup(bad), Err(PincodeError::Invalid), "{bad}");
        }
    }
}
