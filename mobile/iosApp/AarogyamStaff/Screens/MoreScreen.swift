import AarogyamShared
import SafariServices
import SakalyaUI
import SwiftUI

/// A More tile's destination.
enum MoreRoute: Hashable {
    case analytics, expenses, messages, stock, labs, team, rxSets
}

/// The More page of the v7 design: the person's row (avatar, name, role, clinic), a three-column
/// grid of the tiles the role may open, then Switch clinic, Language, Help and Sign out.
struct MoreScreen: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let nav: NavModel
    let onSwitchClinic: () -> Void
    @State private var path: [MoreRoute] = []
    @State private var settingsURL: URL?
    @State private var avatars = false
    @State private var avatarRevision = 0
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                profileRow
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: MoreSizes.gap), count: 3), spacing: MoreSizes.gap) {
                    ForEach(nav.tiles.filter(\.isGridTile), id: \.self) { tile in
                        Button { open(tile) } label: { MoreTileView(tile: tile) }
                            .buttonStyle(.skPressable)
                    }
                }
                .padding(.top, MoreSizes.gridTop)
                VStack(spacing: 3) {
                    let rows = nav.tiles.filter { !$0.isGridTile }
                    ForEach(Array(rows.enumerated()), id: \.element) { index, tile in
                        Button { open(tile) } label: {
                            MoreListRow(tile: tile, clinicName: clinic.session.clinic.name)
                                .background(r.card.color, in: UnevenRoundedRectangle(cornerRadii: MoreSizes.listRadii(index, of: rows.count), style: .continuous))
                        }
                        .buttonStyle(.skPressable)
                    }
                }
                .padding(.top, MoreSizes.gridTop)
                Text("v7.more.version").skTextStyle(SkTypeScale.caption).foregroundStyle(r.onSurfaceVariant.color)
                    .frame(maxWidth: .infinity).padding(.top, SkSpacing.l)
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .background(r.background.color)
        .navigationTitle(String(localized: "v7.more.title"))
        .navigationDestination(for: MoreRoute.self) { route in destination(route) }
        .sheet(item: $settingsURL) { url in SafariView(url: url).ignoresSafeArea() }
        .sheet(isPresented: $avatars) { AvatarPicker(graph: graph) { avatarRevision += 1 }.presentationDetents([.medium, .large]) }
    }

    private var profileRow: some View {
        let r = theme.roles
        let session = clinic.session
        return Button { avatars = true } label: {
            HStack(spacing: SkSpacing.m) {
                SkAvatarFrame(shape: .rounded, size: MoreSizes.avatar, background: r.primaryContainer.color) {
                    MyAvatar(graph: graph).id(avatarRevision)
                }
                .clipShape(RoundedRectangle(cornerRadius: MoreSizes.avatarRadius, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.user.displayName).skTextStyle(SkTypeScale.titleSmall).foregroundStyle(r.onSurface.color)
                    Text(verbatim: "\(RoleNames.name(session.membership.roleKey)) · \(session.clinic.name)")
                        .skTextStyle(SkTypeScale.footnote).foregroundStyle(r.onSurfaceVariant.color)
                    Text("v7.more.change_avatar").skTextStyle(SkTypeScale.footnote).fontWeight(.bold).foregroundStyle(r.primary.color)
                }
                Spacer(minLength: 0)
                V7Icon(name: "chev", size: 18, tint: r.onSurfaceVariant.color)
            }
            .padding(SkSpacing.m)
            .background(r.card.color, in: RoundedRectangle(cornerRadius: MoreSizes.cardRadius, style: .continuous))
        }
        .buttonStyle(.skPressable)
        .padding(.top, 4)
    }

    private func open(_ tile: MoreTile) {
        switch tile {
        case .analytics: path.append(.analytics)
        case .expenses: path.append(.expenses)
        case .messages: path.append(.messages)
        case .stock: path.append(.stock)
        case .labWork: path.append(.labs)
        case .team: path.append(.team)
        case .rxSets: path.append(.rxSets)
        case .settings: settingsURL = URL(string: clinic.api.origin + "/settings")
        case .switchClinic: onSwitchClinic()
        case .language:
            // iOS keeps the per-app language in Settings (Aarogyam > Language).
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        case .help: path.append(.messages)
        case .signOut: graph.signOut()
        case .clinicQr: path.append(.rxSets)
        }
    }

    @ViewBuilder private func destination(_ route: MoreRoute) -> some View {
        switch route {
        case .stock:
            ScreenHost(make: { graph.stock(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                StockPage(holder: holder, state: state)
            }
        case .labs:
            LabsRoute(graph: graph, clinic: clinic)
        default:
            PreviewPage(title: route.title)
        }
    }
}

extension MoreRoute {
    var title: String {
        switch self {
        case .analytics: String(localized: "v7.tile.analytics")
        case .expenses: String(localized: "v7.tile.expenses")
        case .messages: String(localized: "v7.tile.messages")
        case .stock: String(localized: "v7.tile.stock")
        case .labs: String(localized: "v7.tile.lab_work")
        case .team: String(localized: "v7.tile.team")
        case .rxSets: String(localized: "v7.tile.rx_sets")
        }
    }
}

/// Sizes of the More page, from the mockup's `.profrow`, `.tiles` and `.tile` rules.
enum MoreSizes {
    static let avatar: CGFloat = 54
    static let avatarRadius: CGFloat = 18
    static let cardRadius: CGFloat = 22
    static let tileRadius: CGFloat = 20
    static let tileIcon: CGFloat = 38
    static let tileIconRadius: CGFloat = 13
    static let gap: CGFloat = 8
    static let gridTop: CGFloat = 12

    /// The list's corners: 22 on the outer ends, 8 between rows (one row is round all over).
    static func listRadii(_ index: Int, of count: Int) -> RectangleCornerRadii {
        let big: CGFloat = 22, small: CGFloat = 8
        let top = index == 0 ? big : small
        let bottom = index == count - 1 ? big : small
        return RectangleCornerRadii(topLeading: top, bottomLeading: bottom, bottomTrailing: bottom, topTrailing: top)
    }
}

extension MoreTile {
    /// Grid tiles; the rest are list rows below.
    var isGridTile: Bool { ![.switchClinic, .language, .help, .signOut].contains(self) }

    var title: String {
        switch self {
        case .analytics: String(localized: "v7.tile.analytics")
        case .expenses: String(localized: "v7.tile.expenses")
        case .messages: String(localized: "v7.tile.messages")
        case .stock: String(localized: "v7.tile.stock")
        case .labWork: String(localized: "v7.tile.lab_work")
        case .team: String(localized: "v7.tile.team")
        case .clinicQr: String(localized: "v7.tile.clinic_qr")
        case .rxSets: String(localized: "v7.tile.rx_sets")
        case .settings: String(localized: "v7.tile.settings")
        case .switchClinic: String(localized: "v7.tile.switch_clinic")
        case .language: String(localized: "v7.tile.language")
        case .help: String(localized: "v7.tile.help")
        case .signOut: String(localized: "v7.tile.sign_out")
        }
    }

    var subtitle: String? {
        switch self {
        case .analytics: String(localized: "v7.tile.analytics.sub")
        case .expenses: String(localized: "v7.tile.expenses.sub")
        case .messages: String(localized: "v7.tile.messages.sub")
        case .stock: String(localized: "v7.tile.stock.sub")
        case .labWork: String(localized: "v7.tile.lab_work.sub")
        case .team: String(localized: "v7.tile.team.sub")
        case .clinicQr: String(localized: "v7.tile.clinic_qr.sub")
        case .rxSets: String(localized: "v7.tile.rx_sets.sub")
        case .settings: String(localized: "v7.tile.settings.sub")
        case .language: "English · मराठी · हिंदी"
        case .help: String(localized: "v7.tile.help.sub")
        default: nil
        }
    }

    /// The mockup's icon per tile.
    var iconName: String {
        switch self {
        case .analytics: "chart"
        case .expenses: "wallet"
        case .messages: "msg"
        case .stock: "box"
        case .labWork: "flask"
        case .team: "team"
        case .clinicQr: "qr"
        case .rxSets: "rx"
        case .settings: "gear"
        case .switchClinic: "swap"
        case .language: "globe"
        case .help: "help"
        case .signOut: "out"
        }
    }

    /// Tiles the mockup draws on the warm (tertiary) container.
    var warm: Bool { self == .expenses || self == .stock }
}

/// One tile: a 38-point rounded square icon over its label and a small subtitle.
struct MoreTileView: View {
    let tile: MoreTile
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(spacing: 6) {
            V7Icon(name: tile.iconName, size: 19, tint: (tile.warm ? r.onTertiaryContainer : r.onPrimaryContainer).color)
                .frame(width: MoreSizes.tileIcon, height: MoreSizes.tileIcon)
                .background((tile.warm ? r.tertiaryContainer : r.primaryContainer).color, in: RoundedRectangle(cornerRadius: MoreSizes.tileIconRadius, style: .continuous))
            Text(tile.title).font(.system(size: 11.5, weight: .bold)).foregroundStyle(r.onSurface.color).lineLimit(2).multilineTextAlignment(.center)
            if let sub = tile.subtitle {
                Text(sub).font(.system(size: 10, weight: .medium)).foregroundStyle(r.onSurfaceVariant.color).lineLimit(1).padding(.top, -4)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .padding(.horizontal, 8)
        .background(r.card.color, in: RoundedRectangle(cornerRadius: MoreSizes.tileRadius, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// A list row under the grid: icon, label and subtitle, chevron.
struct MoreListRow: View {
    let tile: MoreTile
    let clinicName: String
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        HStack(spacing: 10) {
            V7Icon(name: tile.iconName, size: 19, tint: r.onSurfaceVariant.color)
            VStack(alignment: .leading, spacing: 1) {
                Text(tile.title).font(.system(size: 13.5, weight: .bold)).foregroundStyle(tile == .signOut ? r.error.color : r.onSurface.color)
                if let sub = tile == .switchClinic ? clinicName : tile.subtitle {
                    Text(sub).font(.system(size: 11.5)).foregroundStyle(r.onSurfaceVariant.color)
                }
            }
            Spacer(minLength: 0)
            V7Icon(name: "chev", size: 18, tint: r.onSurfaceVariant.color)
        }
        .padding(.vertical, 9)
        .padding(.horizontal, 11)
        .contentShape(Rectangle())
    }
}

/// The low-stock page.
struct StockPage: View {
    let holder: StockStateHolder
    let state: ListState
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(spacing: 3) {
                switch onEnum(of: state) {
                case .loading:
                    SkLoadingIndicator(String(localized: "v7.loading")).padding(SkSpacing.xxl)
                case .notAllowed:
                    SkEmptyState(String(localized: "today.not_allowed.title"), message: String(localized: "today.not_allowed.message"))
                case .failed(let failed):
                    SkEmptyState(String(localized: "v7.tile.stock"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
                case .loaded(let loaded):
                    let rows = loaded.items.compactMap { $0 as? StockRow }
                    if rows.isEmpty {
                        SkEmptyState(String(localized: "v7.stock.empty.title"), message: String(localized: "v7.stock.empty.message"))
                    }
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        HStack(spacing: 10) {
                            V7Icon(name: "box", size: 19, tint: (row.critical ? r.error : r.onSurfaceVariant).color)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(row.name).font(.system(size: 13.5, weight: .bold)).foregroundStyle(r.onSurface.color)
                                Text(String(format: String(localized: "v7.stock.on_hand"), row.onHand, row.unit, row.reorderLevel))
                                    .font(.system(size: 11.5)).foregroundStyle(r.onSurfaceVariant.color)
                            }
                            Spacer(minLength: 0)
                            SkChip(String(localized: row.critical ? "v7.stock.critical" : "v7.stock.low"), tone: row.critical ? .danger : .warning)
                        }
                        .padding(.vertical, 9).padding(.horizontal, 11)
                        .background(r.card.color, in: UnevenRoundedRectangle(cornerRadii: MoreSizes.listRadii(index, of: rows.count), style: .continuous))
                    }
                }
            }
            .padding(.horizontal, SkSpacing.l)
        }
        .background(r.background.color)
        .navigationTitle(String(localized: "v7.tile.stock"))
        .refreshable { holder.refresh() }
    }
}

/// The web settings page inside the app.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

/// Role keys as people read them.
enum RoleNames {
    static func name(_ key: String) -> String {
        switch key {
        case "owner": String(localized: "v7.role.owner")
        case "doctor": String(localized: "v7.role.doctor")
        case "consultant": String(localized: "v7.role.consultant")
        case "front_desk": String(localized: "v7.role.front_desk")
        case "assistant": String(localized: "v7.role.assistant")
        case "finance": String(localized: "v7.role.finance")
        default: key
        }
    }
}
