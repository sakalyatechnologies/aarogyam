import AarogyamShared
import PhotosUI
import SakalyaUI
import SwiftUI

/// One scrolling form for a new patient: details, allergies, consent, signature, photo, doctor; one Save & queue.
struct IntakeV10Screen: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let phone: String?
    let onDone: () -> Void

    var body: some View {
        ScreenHost(make: { graph.intakeForm(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, form in
            IntakeV10Form(holder: holder, form: form, phone: phone, onDone: onDone)
        }
    }
}

struct IntakeV10Form: View {
    let holder: IntakeFormHolder
    let form: IntakeForm
    let phone: String?
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
                    allergies
                    consent
                    signature
                    photo
                    doctors
                    if form.showReason {
                        field(.reason, label: iv("iv.reason"), text: form.reason) { holder.setReason(text: $0) }
                    }
                    SkPillButton(iv("iv.save"), wide: true) { holder.saveAndQueue() }
                        .disabled(form.submitting)
                        .accessibilityHint(iv("iv.save.hint"))
                }
                .padding(16)
            }
        }
        .scrollDismissesKeyboard(.interactively)
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
            V7Label(text: iv("iv.sex"))
            HStack(spacing: 8) {
                ForEach([Sex.female, Sex.male, Sex.other], id: \.self) { sex in
                    SkChoiceChip(sex.label ?? "", selected: form.sex == sex) { holder.setSex(value: sex) }
                }
            }
        }
    }

    private var allergies: some View {
        VStack(alignment: .leading, spacing: 6) {
            V7Label(text: iv("iv.allergies"))
            SkChoiceChips(
                [""] + form.allergyPicks,
                selected: Set(form.noKnownAllergies ? [""] : Array(form.allergies)),
                label: { $0.isEmpty ? iv("iv.allergies.none") : $0 },
                onToggle: { $0.isEmpty ? holder.toggleNoKnownAllergies() : holder.toggleAllergy(label: $0) }
            )
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
                V7Label(text: iv("iv.sign"))
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
            V7Label(text: iv("iv.photo"))
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
                V7Label(text: iv("iv.doctor"))
                SkChoiceChips(
                    [""] + form.doctors.map(\.id),
                    selected: [form.practitionerId ?? ""],
                    label: { id in id.isEmpty ? iv("iv.doctor.any") : form.doctors.first { $0.id == id }?.name ?? "" },
                    onToggle: { holder.setPractitioner(id: $0.isEmpty ? nil : $0) }
                )
            }
        }
    }

    private func doneCard(_ done: IntakeDone) -> some View {
        VStack(spacing: 16) {
            SkCheckDraw()
            Text(String(format: iv("iv.done"), Int(done.tokenNumber))).font(.title2.weight(.heavy)).multilineTextAlignment(.center)
            if done.filesQueued > 0 {
                Text(String(format: iv("iv.done.files"), Int(done.filesQueued))).font(.footnote)
            }
            if done.filesRefused != nil {
                Text(iv("iv.done.refused")).font(.footnote.weight(.semibold)).foregroundStyle(theme.roles.error.color)
            }
            SkPillButton(iv("iv.next"), wide: true) {
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
