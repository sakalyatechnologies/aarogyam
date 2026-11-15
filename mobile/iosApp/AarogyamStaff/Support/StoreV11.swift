import Foundation

/// Copy for sign-in with a password and account deletion (StoreV11.xcstrings: en, hi, mr).
func s11(_ key: String.LocalizationValue) -> String { String(localized: key, table: "StoreV11") }

func s11f(_ key: String.LocalizationValue, _ args: CVarArg...) -> String { String(format: s11(key), arguments: args) }
