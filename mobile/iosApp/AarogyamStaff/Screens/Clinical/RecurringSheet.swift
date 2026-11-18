import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Add recurring sheet: the amount, category and method, monthly or weekly with its day, a
/// note and Save.
struct RecurringSheet: View {
    let holder: RecurringExpensesStateHolder
    let state: RecurringExpensesState
    @State private var tried = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.skTheme) private var theme

    var body: some View {
        let draft = state.draft
        ScrollView {
            VStack(alignment: .leading, spacing: SkSheetSizes.gap) {
                if draft.saved {
                    VStack(spacing: SkSpacing.l) {
                        SkCheckDraw()
                        SkSheetHeader(CL("c.recur.saved_title"), subtitle: CL("c.recur.saved_message")).multilineTextAlignment(.center)
                        SkPillButton(CL("c.done"), wide: true) { dismiss() }
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    form(draft)
                }
            }
            .padding(.horizontal, SkSheetSizes.paddingH)
            .padding(.top, SkSheetSizes.paddingTop + SkSheetSizes.grabGap)
            .padding(.bottom, SkSheetSizes.paddingBottom)
        }
        .scrollDismissesKeyboard(.interactively)
        .skSheet()
        .presentationDetents([.large])
    }

    @ViewBuilder private func form(_ draft: RecurringDraft) -> some View {
        let r = theme.roles
        SkSheetHeader(CL("c.recur.add"))
        Text(ClinicFormat.rupees(paise: draft.amountPaise))
            .font(.system(size: 42, weight: .heavy)).monospacedDigit().foregroundStyle(r.onSurface.color)
            .minimumScaleFactor(0.5).lineLimit(1).frame(maxWidth: .infinity).padding(.vertical, 6)
            .accessibilityLabel(CLf("c.expenses.amount.a11y", ClinicFormat.rupees(paise: draft.amountPaise)))
        if tried, let problem = holder.problem(d: draft) {
            Text(problem.message).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(r.error.color)
        }
        SkChoiceChips(Array(SpendCategory.allCases), selected: [draft.category], label: { $0.label }) { holder.setCategory(category: $0) }
        SkChoiceChips(Array(PayMethod_.allCases), selected: [draft.method], label: { $0.label }) { holder.setMethod(method: $0) }
        SkKeypad(deleteLabel: CL("c.expenses.delete")) { key in holder.setRupees(text: key.press(draft.rupees, maxDigits: 8)) }
        SkSegmented(RecurEvery.allCases.map(\.label), selectedIndex: draft.every == .monthly ? 0 : 1) { index in
            holder.setEvery(every: index == 0 ? .monthly : .weekly)
        }
        if draft.every == .monthly {
            RecurringLabel(text: CL("c.recur.day_label"))
            SkChoiceChips(Array(1...28), selected: draft.dayOfMonth.map { [Int($0.int32Value)] } ?? [], label: { String($0) }) {
                holder.setDayOfMonth(day: Int32($0))
            }
        } else {
            RecurringLabel(text: CL("c.recur.weekday_label"))
            SkChoiceChips(Array(1...7), selected: draft.weekday.map { [Int($0.int32Value)] } ?? [], label: { RecurEvery.weekdayName($0) }) {
                holder.setWeekday(day: Int32($0))
            }
        }
        SkField(CL("c.expenses.note"), text: Binding(get: { draft.note }, set: { holder.setNote(text: $0) }), placeholder: CL("c.recur.note_prompt"))
        if let error = draft.error?.message {
            Text(error).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(r.error.color)
        }
        SkPillButton(CL("c.recur.save"), variant: .warm, wide: true, loading: draft.saving) {
            tried = true
            holder.save()
        }
    }
}
