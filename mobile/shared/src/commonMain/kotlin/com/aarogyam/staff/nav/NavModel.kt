package com.aarogyam.staff.nav

/** A bottom tab (Android floating bar or rail, iOS tab bar). Labels are the apps' strings. */
enum class Tab {
    Today,
    Patients,
    Schedule,
    Expenses,
    More,
}

/** The bar's trailing action: the one thing each kind of role starts most. */
enum class PrimaryAction {
    WalkIn,
    AddExpense,
}

/** A tile on the More page. */
enum class MoreTile {
    Analytics,
    Expenses,
    Messages,
    Stock,
    LabWork,
    Team,
    ClinicQr,
    RxSets,
    Settings,
    SwitchClinic,
    Language,
    Help,
    SignOut,
}

/** Whether a screen shows real server data or the designed "needs server support" preview. */
enum class Support {
    Real,
    Preview,
}

/** What Today leads with: the clinic's day, or money for finance-only roles. */
enum class TodayKind {
    Clinic,
    Money,
}

/**
 * The navigation for one person in one clinic: which tabs, bar action and More tiles they get.
 * Built from permission keys only, so a role the owner edits in web settings changes it too.
 */
data class NavModel(
    val tabs: List<Tab>,
    val action: PrimaryAction?,
    val tiles: List<MoreTile>,
    val today: TodayKind,
) {
    /** Whether [tile] has its server support yet (team chat and Rx sets do; see the backlog). */
    fun support(tile: MoreTile): Support = if (tile in PREVIEW_TILES) Support.Preview else Support.Real

    companion object {
        private val PREVIEW_TILES: Set<MoreTile> = emptySet()

        /** The model for a member holding [permissions], with [clinicCount] clinics to switch between. */
        fun of(
            permissions: Set<String>,
            clinicCount: Int,
        ): NavModel {
            fun has(key: String) = key in permissions
            val clinical = has(APPOINTMENTS_READ)
            val money = has(FINANCE_VIEW)
            val tabs =
                buildList {
                    if (clinical || money) add(Tab.Today)
                    if (has(PATIENTS_READ)) add(Tab.Patients)
                    if (clinical) {
                        add(Tab.Schedule)
                    } else if (money) {
                        add(Tab.Expenses)
                    }
                    add(Tab.More)
                }
            val action =
                when {
                    clinical && has(INTAKE_WRITE) -> PrimaryAction.WalkIn
                    !clinical && has(EXPENSES_WRITE) -> PrimaryAction.AddExpense
                    else -> null
                }
            val tiles =
                buildList {
                    if (has(ANALYTICS_VIEW)) add(MoreTile.Analytics)
                    if (money && Tab.Expenses !in tabs) add(MoreTile.Expenses)
                    if (clinical) add(MoreTile.Messages)
                    if (has(INVENTORY_READ)) add(MoreTile.Stock)
                    if (has(LABS_READ)) add(MoreTile.LabWork)
                    if (has(CHAT_USE) || has(STAFF_MANAGE)) add(MoreTile.Team)
                    add(MoreTile.ClinicQr)
                    if (has(PRESCRIPTIONS_ISSUE)) add(MoreTile.RxSets)
                    add(MoreTile.Settings)
                    if (clinicCount > 1) add(MoreTile.SwitchClinic)
                    add(MoreTile.Language)
                    add(MoreTile.Help)
                    add(MoreTile.SignOut)
                }
            return NavModel(tabs, action, tiles, if (clinical) TodayKind.Clinic else TodayKind.Money)
        }

        const val APPOINTMENTS_READ = "appointments.read"
        const val FINANCE_VIEW = "finance.view"
        const val PATIENTS_READ = "patients.read"
        const val INTAKE_WRITE = "intake.write"
        const val EXPENSES_WRITE = "expenses.write"
        const val ANALYTICS_VIEW = "analytics.view"
        const val INVENTORY_READ = "inventory.read"
        const val LABS_READ = "labs.read"
        const val CHAT_USE = "chat.use"
        const val STAFF_MANAGE = "staff.manage"
        const val PRESCRIPTIONS_ISSUE = "prescriptions.issue"
    }
}
