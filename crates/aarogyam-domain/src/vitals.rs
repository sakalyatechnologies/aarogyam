//! Vital signs: what each measurement is, its units, and the range a real reading can fall in.
//! Readings outside the range are refused as typing mistakes (120 kg typed as 1200).

use std::fmt;

use crate::clinical::{ClinicalError, text_enum};

text_enum!(
    /// What was measured.
    VitalKind {
        /// Systolic blood pressure.
        BpSystolic => "bp_systolic",
        /// Diastolic blood pressure.
        BpDiastolic => "bp_diastolic",
        /// Pulse rate.
        Pulse => "pulse",
        /// Body temperature.
        Temperature => "temperature",
        /// Oxygen saturation.
        Spo2 => "spo2",
        /// Body weight.
        Weight => "weight",
        /// Body height.
        Height => "height",
        /// Blood glucose (random).
        BloodSugar => "blood_sugar",
    }
);

text_enum!(
    /// A unit, as its UCUM code.
    Unit {
        /// Millimetres of mercury.
        MmHg => "mmHg",
        /// Per minute.
        PerMinute => "/min",
        /// Degrees Celsius.
        Celsius => "Cel",
        /// Degrees Fahrenheit.
        Fahrenheit => "[degF]",
        /// Percent.
        Percent => "%",
        /// Kilograms.
        Kilogram => "kg",
        /// Centimetres.
        Centimetre => "cm",
        /// Milligrams per decilitre.
        MgPerDl => "mg/dL",
    }
);

impl Unit {
    /// Parses a UCUM code or a common way of writing it (`bpm`, `C`, `°F`).
    ///
    /// # Errors
    /// [`ClinicalError::UnknownValue`] for anything else.
    pub fn parse_loose(text: &str) -> Result<Self, ClinicalError> {
        match text.trim() {
            "bpm" | "/min" | "per min" => Ok(Self::PerMinute),
            "C" | "°C" | "Cel" => Ok(Self::Celsius),
            "F" | "°F" | "[degF]" => Ok(Self::Fahrenheit),
            other => Self::parse(other),
        }
    }
}

/// Why a reading was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum VitalError {
    /// The unit doesn't fit the measurement.
    #[error("unit must be one of {0}")]
    Unit(&'static str),
    /// The value is outside what a living patient can have.
    #[error("must be between {min} and {max} {unit}")]
    Range {
        /// Lowest plausible value.
        min: u16,
        /// Highest plausible value.
        max: u16,
        /// The unit.
        unit: &'static str,
    },
    /// Diastolic pressure at or above systolic.
    #[error("diastolic pressure must be below systolic")]
    Pressure,
}

impl VitalKind {
    /// The unit used when none is given.
    #[must_use]
    pub const fn default_unit(self) -> Unit {
        match self {
            Self::BpSystolic | Self::BpDiastolic => Unit::MmHg,
            Self::Pulse => Unit::PerMinute,
            Self::Temperature => Unit::Celsius,
            Self::Spo2 => Unit::Percent,
            Self::Weight => Unit::Kilogram,
            Self::Height => Unit::Centimetre,
            Self::BloodSugar => Unit::MgPerDl,
        }
    }

    /// The LOINC code recorded with the reading.
    #[must_use]
    pub const fn loinc(self) -> &'static str {
        match self {
            Self::BpSystolic => "8480-6",
            Self::BpDiastolic => "8462-4",
            Self::Pulse => "8867-4",
            Self::Temperature => "8310-5",
            Self::Spo2 => "59408-5",
            Self::Weight => "29463-7",
            Self::Height => "8302-2",
            Self::BloodSugar => "2339-0",
        }
    }

    /// The plausible range for this kind in `unit`, or the units it accepts.
    fn range(self, unit: Unit) -> Result<(u16, u16), VitalError> {
        match (self, unit) {
            (Self::BpSystolic, Unit::MmHg) => Ok((50, 260)),
            (Self::BpDiastolic, Unit::MmHg) => Ok((30, 160)),
            (Self::Pulse, Unit::PerMinute) => Ok((20, 250)),
            (Self::Temperature, Unit::Celsius) => Ok((30, 45)),
            (Self::Temperature, Unit::Fahrenheit) => Ok((86, 113)),
            (Self::Spo2, Unit::Percent) => Ok((50, 100)),
            (Self::Weight, Unit::Kilogram) => Ok((1, 350)),
            (Self::Height, Unit::Centimetre) => Ok((30, 250)),
            (Self::BloodSugar, Unit::MgPerDl) => Ok((20, 600)),
            (Self::Temperature, _) => Err(VitalError::Unit("Cel, [degF]")),
            (Self::BpSystolic | Self::BpDiastolic, _) => Err(VitalError::Unit("mmHg")),
            (Self::Pulse, _) => Err(VitalError::Unit("/min")),
            (Self::Spo2, _) => Err(VitalError::Unit("%")),
            (Self::Weight, _) => Err(VitalError::Unit("kg")),
            (Self::Height, _) => Err(VitalError::Unit("cm")),
            (Self::BloodSugar, _) => Err(VitalError::Unit("mg/dL")),
        }
    }
}

/// A reading that passed the checks, rounded to two decimal places.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Reading {
    kind: VitalKind,
    value: f64,
    unit: Unit,
}

impl Reading {
    /// Checks a reading against its kind's units and plausible range.
    ///
    /// # Errors
    /// [`VitalError::Unit`] for a unit that doesn't fit; [`VitalError::Range`] for an
    /// implausible value.
    pub fn new(kind: VitalKind, value: f64, unit: Option<Unit>) -> Result<Self, VitalError> {
        let unit = unit.unwrap_or(kind.default_unit());
        let (min, max) = kind.range(unit)?;
        let rounded = (value * 100.0).round() / 100.0;
        if !rounded.is_finite() || rounded < f64::from(min) || rounded > f64::from(max) {
            return Err(VitalError::Range {
                min,
                max,
                unit: unit.as_str(),
            });
        }
        Ok(Self {
            kind,
            value: rounded,
            unit,
        })
    }

    /// What was measured.
    #[must_use]
    pub const fn kind(&self) -> VitalKind {
        self.kind
    }

    /// The value, to two decimal places.
    #[must_use]
    pub const fn value(&self) -> f64 {
        self.value
    }

    /// The unit.
    #[must_use]
    pub const fn unit(&self) -> Unit {
        self.unit
    }
}

/// Checks readings taken together: a diastolic pressure must be below the systolic one.
///
/// # Errors
/// [`VitalError::Pressure`] when it isn't.
pub fn check_together(readings: &[Reading]) -> Result<(), VitalError> {
    let find = |kind| readings.iter().find(|r| r.kind == kind).map(Reading::value);
    match (find(VitalKind::BpSystolic), find(VitalKind::BpDiastolic)) {
        (Some(systolic), Some(diastolic)) if diastolic >= systolic => Err(VitalError::Pressure),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readings_use_default_units_and_round() {
        let pulse = Reading::new(VitalKind::Pulse, 72.456, None).unwrap();
        assert_eq!(pulse.unit(), Unit::PerMinute);
        assert!((pulse.value() - 72.46).abs() < f64::EPSILON);
        assert_eq!(VitalKind::Weight.loinc(), "29463-7");
    }

    #[test]
    fn implausible_values_and_wrong_units_are_refused() {
        assert_eq!(
            Reading::new(VitalKind::Weight, 1200.0, None),
            Err(VitalError::Range {
                min: 1,
                max: 350,
                unit: "kg"
            })
        );
        assert!(Reading::new(VitalKind::Spo2, 101.0, None).is_err());
        assert!(Reading::new(VitalKind::Spo2, f64::NAN, None).is_err());
        assert!(Reading::new(VitalKind::Temperature, 98.6, None).is_err());
        assert!(Reading::new(VitalKind::Temperature, 98.6, Some(Unit::Fahrenheit)).is_ok());
        assert_eq!(
            Reading::new(VitalKind::Pulse, 72.0, Some(Unit::Kilogram)),
            Err(VitalError::Unit("/min"))
        );
        assert_eq!(Unit::parse_loose("°F"), Ok(Unit::Fahrenheit));
        assert_eq!(Unit::parse_loose("bpm"), Ok(Unit::PerMinute));
        assert!(Unit::parse_loose("stone").is_err());
    }

    #[test]
    fn diastolic_must_be_below_systolic() {
        let systolic = Reading::new(VitalKind::BpSystolic, 120.0, None).unwrap();
        let low = Reading::new(VitalKind::BpDiastolic, 80.0, None).unwrap();
        let high = Reading::new(VitalKind::BpDiastolic, 130.0, None).unwrap();
        assert_eq!(check_together(&[systolic, low]), Ok(()));
        assert_eq!(check_together(&[systolic, high]), Err(VitalError::Pressure));
        assert_eq!(check_together(&[high]), Ok(()));
    }
}
