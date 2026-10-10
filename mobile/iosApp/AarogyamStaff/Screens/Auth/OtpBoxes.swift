import SakalyaUI
import SwiftUI

/// The sign-in code as separate boxes (`.otp`): a hidden field takes the typing and the SMS or
/// email autofill (`.oneTimeCode`), the boxes only show it. The current box is outlined and lifted.
struct OtpBoxes: View {
    let count: Int
    @Binding var code: String
    var onComplete: () -> Void = {}
    @FocusState private var focused: Bool
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ZStack {
            TextField("", text: $code)
                .keyboardType(.numberPad).textContentType(.oneTimeCode)
                .focused($focused).opacity(0.02).frame(height: 56)
                .accessibilityLabel(String(localized: "sign_in.code_label"))
                .accessibilityValue(code)
            HStack(spacing: count > 6 ? 6 : 8) {
                ForEach(0..<count, id: \.self) { index in
                    let digit = OtpBoxes.digit(code, at: index)
                    Text(digit ?? "")
                        .font(.system(size: 22, weight: .bold, design: .monospaced)).minimumScaleFactor(0.6)
                        .foregroundStyle(r.onSurface.color)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(index == OtpBoxes.current(code, count: count) && focused || digit != nil ? r.primary.color : .clear, lineWidth: 2))
                        .offset(y: digit != nil ? -3 : 0)
                        .animation(SkMotionTokens.pressSpring.animation, value: digit)
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
        .onAppear { focused = true }
        .onChange(of: code) { _, new in
            let digits = String(new.filter(\.isNumber).prefix(count))
            if digits != new { code = digits }
            if digits.count == count { onComplete() }
        }
    }

    /// The digit shown in box [index], or nil when it is still empty.
    static func digit(_ code: String, at index: Int) -> String? {
        let digits = Array(code)
        return index < digits.count ? String(digits[index]) : nil
    }

    /// The box the next digit goes into.
    static func current(_ code: String, count: Int) -> Int { min(code.count, count - 1) }
}
