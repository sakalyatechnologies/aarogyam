import AarogyamShared
import PhotosUI
import SakalyaUI
import SwiftUI

/// One scrolling form for a new patient: details, allergies, consent, signature, photo, doctor; Save & queue
/// pinned at the bottom as the glass primary button (Clear Glass section headers and chips).
struct IntakeV10Screen: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let phone: String?
    var family: [DeskFamilyAnchor] = []
    var ends: IntakeEnds = IntakeEnds()
    let onDone: () -> Void

    var body: some View {
        ScreenHost(make: { graph.intakeForm(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, form in
            IntakeV10Form(holder: holder, form: form, phone: phone, family: family, ends: ends, onDone: onDone)
        }
    }
}

/// What the form may do after saving a new patient besides checking them in: book a visit ([onBook], shown with
/// appointments.write) and open the saved patient ([onOpen]). Without them only "Check in now" shows.
struct IntakeEnds {
    var onBook: ((_ patientId: String, _ name: String) -> Void)?
    var onOpen: ((_ patientId: String) -> Void)?
}

struct IntakeV10Form: View {
    let holder: IntakeFormHolder
    let form: IntakeForm
    let phone: String?
    var family: [DeskFamilyAnchor] = []
    var ends: IntakeEnds = IntakeEnds()
    let onDone: () -> Void
    @Environment(\.skTheme) private var theme
    @State private var useAge = false
    @State private var clearToken = 0
    @State private var library: PhotosPickerItem?
    @State private var camera = false
    @State private var photoPreview: UIImage?

    var body: some View {
        ScrollView {
            if let done = form.done {
                doneCard(done)
            } else {
                VStack(alignment: .leading, spacing: 14) {
                    Text(iv("iv.title")).font(.title2.weight(.heavy)).accessibilityAddTraits(.isHeader)
                    banner
                    details
                    if form.showFamily, !family.isEmpty { IntakeV10Family(holder: holder, people: family) }
                    allergies
                    consent
                    signature
                    photo
                    doctors
                    if form.showReason {
                        field(.reason, label: iv("iv.reason"), text: form.reason) { holder.setReason(text: $0) }
                    }
                }
                .padding(16)
            }
        }
        .scrollDismissesKeyboard(.immediately)
        .safeAreaInset(edge: .bottom) {
            if form.done == nil { endButtons }
        }
        .onChange(of: form.done) { _, done in
            // "Book appointment": the patient is saved; the booking sheet opens on them.
            if let done, done.next == .book { ends.onBook?(done.patientId, form.name) }
        }
        .onAppear {
            if let phone, form.phone.isEmpty { holder.setPhone(typed: phone) }
        }
        .onChange(of: library) { _, item in
            Task {
                if let data = try? await item?.loadTransferable(type: Data.self) { attach(data) }
            }
        }
        .sheet(isPresented: $camera) { CameraPicker { attach($0) }.ignoresSafeArea() }
    }

    // MARK: sections

    @ViewBuilder private var banner: some View {
        if let error = form.submitError {
            Text(IntakeV10Logic.submitText(error))
                .font(.footnote.weight(.semibold))
                .foregroundStyle(theme.roles.onErrorContainer.color)
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.roles.errorContainer.color, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityAddTraits(.isStaticText)
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 12) {
            field(.phone, label: iv("iv.phone"), text: form.phone, type: .telephoneNumber, keyboard: .phonePad) { holder.setPhone(typed: $0) }
            field(.name, label: iv("iv.name"), text: form.name, type: .name) { holder.setName(text: $0) }
            SkSegmented([iv("iv.dob"), iv("iv.age")], selectedIndex: useAge ? 1 : 0) { useAge = $0 == 1 }
            if useAge {
                field(.birth, label: iv("iv.age"), text: form.age, keyboard: .numberPad) { holder.setAge(text: $0) }
            } else {
                field(.birth, label: iv("iv.dob"), text: form.dateOfBirth, placeholder: iv("iv.dob.hint"), keyboard: .numberPad) {
                    holder.setDateOfBirth(text: IntakeV10Logic.dateText($0))
                }
            }
            field(.email, label: iv("iv.email"), text: form.email, type: .emailAddress, keyboard: .emailAddress) { holder.setEmail(text: $0) }
            GroupedHeader(iv("iv.sex"))
            HStack(spacing: 8) {
                ForEach([Sex.female, Sex.male, Sex.other], id: \.self) { sex in
                    GlassChip(text: sex.label ?? "", selected: form.sex == sex, check: true) { holder.setSex(value: sex) }
                }
            }
            GroupedHeader(String(localized: "address.title"))
            AddressFields(address: form.address) { holder.setAddress(field: $0, text: $1) }
        }
    }

    private var allergies: some View {
        VStack(alignment: .leading, spacing: 6) {
            GroupedHeader(iv("iv.allergies"))
            V7Flow(spacing: 8) {
                GlassChip(text: iv("iv.allergies.none"), selected: form.noKnownAllergies, check: true) { holder.toggleNoKnownAllergies() }
                ForEach(form.allergyPicks, id: \.self) { pick in
                    GlassChip(text: pick, selected: !form.noKnownAllergies && form.allergies.contains(pick), check: true) { holder.toggleAllergy(label: pick) }
                }
            }
            problem(.allergies)
        }
    }

    private var consent: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let notice = form.notice {
                V7Label(text: notice.label)
                Text(notice.body).font(.callout).fixedSize(horizontal: false, vertical: true)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.roles.surface3.color, in: RoundedRectangle(cornerRadius: 12))
            }
            Toggle(isOn: Binding(get: { form.readAloud }, set: { holder.setReadAloud(on: $0) })) {
                Text(iv("iv.readaloud")).font(.callout.weight(.semibold))
            }.tint(theme.roles.primary.color)
            problem(.consent)
            Toggle(isOn: Binding(get: { form.reminders }, set: { holder.setReminders(on: $0) })) {
                Text(iv("iv.reminders")).font(.callout.weight(.semibold))
            }.tint(theme.roles.primary.color)
        }
    }

    private var signature: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                GroupedHeader(iv("iv.sign"))
                Spacer()
                SkPillButton(iv("iv.sign.clear"), variant: .ghost) { clearToken += 1 }
            }
            IntakeSignaturePad(clearToken: clearToken) { holder.setSignature(png: $0?.kotlinBytes) }
                .frame(height: 160)
                // The UIKit label doesn't reach the tree through the representable, so name it here. Direct
                // interaction lets a VoiceOver user sign with a finger.
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(iv("iv.sign.a11y"))
                .accessibilityAddTraits(.allowsDirectInteraction)
                .accessibilityIdentifier("intake.signature")
            problem(.signature)
        }
    }

    private var photo: some View {
        VStack(alignment: .leading, spacing: 6) {
            GroupedHeader(iv("iv.photo"))
            if form.photoPresent {
                HStack(spacing: 12) {
                    if let photoPreview {
                        Image(uiImage: photoPreview).resizable().scaledToFill().frame(width: 64, height: 64)
                            .clipShape(RoundedRectangle(cornerRadius: 10)).accessibilityHidden(true)
                    }
                    SkPillButton(iv("iv.photo.remove"), variant: .ghost) { holder.setPhoto(jpeg: nil); photoPreview = nil; library = nil }
                }
            } else {
                FlowLayout(spacing: 8) {
                    if CameraPicker.isAvailable { SkPillButton(iv("iv.photo.camera"), variant: .tonal) { camera = true } }
                    PhotosPicker(selection: $library, matching: .images) {
                        Text(iv("iv.photo.library")).font(.system(size: 14, weight: .bold))
                            .foregroundStyle(theme.roles.onPrimaryContainer.color)
                            .padding(.horizontal, 18).frame(minHeight: SkSpacing.minTouchTarget)
                            .background(theme.roles.primaryContainer.color, in: Capsule())
                    }
                }
            }
        }
    }

    @ViewBuilder private var doctors: some View {
        if !form.doctors.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                GroupedHeader(iv("iv.doctor"))
                V7Flow(spacing: 8) {
                    GlassChip(text: iv("iv.doctor.any"), selected: form.practitionerId == nil) { holder.setPractitioner(id: nil) }
                    ForEach(form.doctors, id: \.id) { doctor in
                        GlassChip(text: doctor.name, selected: form.practitionerId == doctor.id) { holder.setPractitioner(id: doctor.id) }
                    }
                }
            }
        }
    }

    /// How the intake ends: check in now (primary), or save the patient to book a visit, or just save them.
    private var endButtons: some View {
        VStack(spacing: 8) {
            if ends.onBook == nil && ends.onOpen == nil {
                GlassWideButton(title: iv("iv.save"), systemImage: "checkmark", loading: form.submitting) { holder.saveAndQueue() }
                    .accessibilityHint(iv("iv.save.hint"))
            } else {
                GlassWideButton(title: iv("iv.end.check_in"), systemImage: "checkmark", loading: form.submitting) { holder.saveAndQueue() }
                    .accessibilityHint(iv("iv.save.hint"))
                HStack(spacing: 8) {
                    if ends.onBook != nil {
                        SkPillButton(iv("iv.end.book"), variant: .tonal, wide: true) { holder.save(next: .book) }
                            .disabled(form.submitting)
                    }
                    SkPillButton(iv("iv.end.save_only"), variant: .tonal, wide: true) { holder.save(next: .saveOnly) }
                        .disabled(form.submitting)
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
    }

    private func doneCard(_ done: IntakeDone) -> some View {
        VStack(spacing: 16) {
            SkCheckDraw()
            if let token = done.tokenNumber {
                Text(String(format: iv("iv.done"), token.intValue)).font(.title2.weight(.heavy)).multilineTextAlignment(.center)
            } else {
                Text(iv("iv.saved")).font(.title2.weight(.heavy)).multilineTextAlignment(.center)
            }
            if done.filesQueued > 0 {
                Text(String(format: iv("iv.done.files"), Int(done.filesQueued))).font(.footnote)
            }
            if done.filesRefused != nil {
                Text(iv("iv.done.refused")).font(.footnote.weight(.semibold)).foregroundStyle(theme.roles.error.color)
            }
            if done.tokenNumber == nil, let open = ends.onOpen {
                SkPillButton(iv("iv.open_profile"), variant: .tonal, wide: true) { open(done.patientId) }
            }
            GlassWideButton(title: iv("iv.next")) {
                holder.reset(); photoPreview = nil; library = nil; clearToken += 1; useAge = false; onDone()
            }
        }
        .padding(24).frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }

    // MARK: pieces

    private func field(_ f: IntakeField, label: String, text: String, placeholder: String = "", type: UITextContentType? = nil,
                       keyboard: UIKeyboardType = .default, set: @escaping (String) -> Void) -> some View {
        SkField(label, text: Binding(get: { text }, set: set), placeholder: placeholder,
                error: form.errors[f].map { IntakeV10Logic.problemText(f, $0) }, contentType: type, keyboard: keyboard)
    }

    @ViewBuilder private func problem(_ f: IntakeField) -> some View {
        if let p = form.errors[f] {
            Text(IntakeV10Logic.problemText(f, p)).font(.footnote.weight(.semibold)).foregroundStyle(theme.roles.error.color)
        }
    }

    private func attach(_ data: Data) {
        guard let jpeg = IntakeV10Logic.photoJPEG(from: data) else { return }
        photoPreview = UIImage(data: jpeg)
        holder.setPhoto(jpeg: jpeg.kotlinBytes)
    }
}
