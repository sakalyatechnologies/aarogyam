//! The `upi://pay` deep link a patient's UPI app opens to pay a bill. No gateway: the money goes
//! straight to the clinic's own UPI ID, and the front desk records the payment as usual.

use std::fmt::Write as _;

/// Percent-encodes everything except RFC 3986 unreserved characters.
fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(char::from(byte));
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}

/// The payment link for `amount_paise` (a positive amount) to `upi_id`, naming the payee and
/// carrying the invoice number as the transaction note and reference.
#[must_use]
pub fn pay_link(upi_id: &str, payee: &str, amount_paise: i64, invoice_number: &str) -> String {
    format!(
        "upi://pay?pa={}&pn={}&am={}.{:02}&cu=INR&tn={}&tr={}",
        encode(upi_id).replace("%40", "@"),
        encode(payee),
        amount_paise / 100,
        amount_paise % 100,
        encode(&format!("Bill {invoice_number}")),
        encode(invoice_number),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_an_encoded_link_with_rupees_and_paise() {
        assert_eq!(
            pay_link("alpha@okicici", "Alpha Dental", 123_405, "AD/26-27/000007"),
            "upi://pay?pa=alpha@okicici&pn=Alpha%20Dental&am=1234.05&cu=INR\
             &tn=Bill%20AD%2F26-27%2F000007&tr=AD%2F26-27%2F000007"
        );
    }
}
