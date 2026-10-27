import AarogyamShared
import SakalyaUI
import SwiftUI
import XCTest
@testable import AarogyamStaff

@MainActor
final class V7ShellTests: XCTestCase {
    func test_tabs_map_to_the_mockups_icons() {
        XCTAssertEqual(NavTab.today.iconName, "home")
        XCTAssertEqual(NavTab.schedule.iconName, "cal")
        XCTAssertEqual(NavTab.expenses.iconName, "wallet")
        XCTAssertEqual(NavTab.more.iconName, "grid")
    }

    func test_every_tile_icon_is_in_the_catalogue() {
        for tile in [MoreTile.analytics, .expenses, .messages, .stock, .labWork, .team, .clinicQr, .rxSets, .settings, .switchClinic, .language, .help, .signOut] {
            XCTAssertNotNil(IconArt.shared.all[tile.iconName], "\(tile)")
            XCTAssertFalse(V7Icon.path(tile.iconName)?.ops.isEmpty ?? true)
        }
        XCTAssertFalse(MoreTile.signOut.isGridTile)
        XCTAssertTrue(MoreTile.stock.isGridTile && MoreTile.stock.warm)
    }

    func test_list_corners_round_only_the_outer_ends() {
        XCTAssertEqual(MoreSizes.listRadii(0, of: 3).topLeading, 22)
        XCTAssertEqual(MoreSizes.listRadii(0, of: 3).bottomLeading, 8)
        XCTAssertEqual(MoreSizes.listRadii(2, of: 3).bottomTrailing, 22)
        XCTAssertEqual(MoreSizes.listRadii(0, of: 1).bottomTrailing, 22)
    }

    func test_week_hours_read_like_the_mockup() {
        XCTAssertEqual(WeekGrid.hourLabel(9), "9")
        XCTAssertEqual(WeekGrid.hourLabel(12), "12 pm")
        XCTAssertEqual(WeekGrid.hourLabel(15), "3")
    }

    func test_art_loops_and_avatars_prepare() {
        XCTAssertNotNil(ArtLoops.loop("bob"))
        XCTAssertEqual(ArtLoops.loop("twinkle2")?.1, SkLoopTokens.twinkleOffsetMs)
        XCTAssertNil(ArtLoops.loop("nope"))
        let art = ArtCache.art(AvatarArt.shared.all["d3"]!)
        XCTAssertEqual(art.viewBox, CGRect(x: 0, y: 0, width: 100, height: 100))
        XCTAssertTrue(art.animated)
        XCTAssertFalse(art.layers.isEmpty)
    }

    /// The avatar redraws 30 times a second, so its paints and loops are resolved up front.
    func test_art_painter_resolves_paints_and_loops_once() {
        let art = ArtCache.art(AvatarArt.shared.all["d3"]!)
        let roles = SkRoles(tokens: roleTokens(ClinicBranding.companion.Default.theme(systemDark: false).palette))!
        let painter = ArtPainter(art: art, roles: roles, tint: .blue)
        XCTAssertEqual(painter.layers.count, art.layers.count)
        let loopCount = art.layers.reduce(0) { $0 + $1.layer.loops.count }
        XCTAssertEqual(painter.layers.reduce(0) { $0 + $1.loops.count } + painter.rootLoops.count, loopCount + art.rootLoops.count)
    }

    func test_palette_roles_come_through_as_hex() {
        let theme = ClinicBranding.companion.Default.theme(systemDark: false)
        let tokens = roleTokens(theme.palette)
        XCTAssertEqual(tokens.count, 28)
        XCTAssertTrue(tokens.values.allSatisfy { $0.hasPrefix("#") && $0.count == 7 })
        XCTAssertNotNil(SkRoles(tokens: tokens))
    }
}
