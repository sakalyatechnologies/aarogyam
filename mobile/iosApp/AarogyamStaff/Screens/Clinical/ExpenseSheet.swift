import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Add expense sheet: a big amount, category and method chips, the keypad, a note, and
/// Save. Bill photo waits for server support (Preview).
struct ExpenseSheet: View {
    let holder: ExpensesStateHolder
    let state: ExpensesState
    @State private var tried = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.skTheme) private var theme

    var body: some View {
        let draft = state.draft
        ScrollView {
            VStack(alignment: .leading, spacing: SkSheetSizes.gap) {
                if draft.saved {
                    savedView
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

    @ViewBuilder private func form(_ draft: ExpenseDraft) -> some View {
        let r = theme.roles
        SkSheetHeader(CL("c.expenses.add"))
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
        SkField(CL("c.expenses.note"), text: Binding(get: { draft.note }, set: { holder.setNote(text: $0) }), placeholder: CL("c.expenses.note.prompt"))
        if let error = draft.error?.message {
            Text(error).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(r.error.color)
        }
        HStack(spacing: SkSpacing.sm) {
            SkPillButton(CL("c.expenses.photo"), variant: .tonal, icon: V7Icon.path("cam"), wide: true) {}.disabled(true)
            SkPillButton(CL("c.expenses.save"), variant: .warm, wide: true, loading: draft.saving) {
                tried = true
                holder.save()
            }
            .layoutPriority(1)
        }
        if state.photoPreview { PreviewNotice(text: CL("c.expenses.photo.preview")) }
    }

    private var savedView: some View {
        VStack(spacing: SkSpacing.l) {
            SkCheckDraw()
            SkSheetHeader(CL("c.expenses.saved.title"), subtitle: CL("c.expenses.saved.message")).multilineTextAlignment(.center)
            SkPillButton(CL("c.done"), wide: true) { dismiss() }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The sheet over its own state holder, for the bar action and the Analytics card.
struct ExpenseSheetHost: View {
    let graph: AppGraph
    let clinic: ClinicContext
    var onSaved: () -> Void = {}

    var body: some View {
        ScreenHost(make: { graph.expenses(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
            ExpenseSheet(holder: holder, state: state)
                .onChange(of: state.draft.saved) { _, saved in if saved { onSaved() } }
        }
    }
}
