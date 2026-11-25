import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.openapitools.generator.gradle.plugin.tasks.GenerateTask

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.android.kmp.library)
    alias(libs.plugins.android.lint)
    alias(libs.plugins.openapi.generator)
    // Swift sees flows as AsyncSequence, sealed types as enums and suspend functions as async.
    alias(libs.plugins.skie)
}

// The models the screens use, generated from the committed OpenAPI document. Add a schema here
// when a screen needs it; the build regenerates them whenever docs/api/openapi.json changes.
val apiModels =
    listOf(
        "Me",
        "SmileShade",
        "MyClinic",
        "Session",
        "SessionClinic",
        "SessionMembership",
        "SessionUser",
        "TodayResponse",
        "TodayCounts",
        "Appointment",
        "PatientBrief",
        "PractitionerBrief",
        "AttentionItem",
        "AttentionPatient",
        "HourBar",
        "ChairStatus",
        "ChairAppointment",
        "LowStockAlert",
        "QueueToken",
        "TeamMemberToday",
        "TodayShift",
        "SearchRequest",
        "PatientList",
        "Patient",
        "PatientAddress",
        "NextAppointment",
        "ClinicalFlags",
        "Allergy",
        "Condition",
        "Attachment",
        "AttachmentList",
        "DownloadLink",
        "Code",
        "VisitList",
        "Visit",
        "VisitDetail",
        "MemberRef",
        "PatientHistory",
        "HistoryVisit",
        "HistoryTooth",
        "HistoryFile",
        "HistoryBill",
        "HistoryPlan",
        "HistoryCounts",
        "AppointmentList",
        "PractitionerList",
        "Practitioner",
        "RoomList",
        "Room",
        "DentalChart",
        "ToothStatus",
        "ToothHealth",
        "NewToothStatus",
        // Visit story v2 §1.13: the chart's detail taps (the phones write them; the mouth
        // snapshot goes raw to the WebView, so it has no models here).
        "ToothCondition",
        "ToothEruption",
        "NewToothCondition",
        "NewToothEruption",
        "DetailInError",
        "ChartEntry",
        "NewChartEntries",
        "NewChartEntry",
        "DentalTerm",
        "NewDentalTerm",
        "Drug",
        "DrugList",
        "DrugSearch",
        "Prescription",
        "PrescriptionList",
        "RxItem",
        "RxValues",
        "Alert",
        "IssueBlocked",
        "AllergyCheck",
        "AllergyCheckRequest",
        "AllergyCheckItem",
        "PatientRef",
        "PrintData",
        "IssueRequest",
        "ShareLink",
        "RecordShare",
        "RecordShares",
        "RecordShareItem",
        "NewRecordShare",
        "InvoiceList",
        "Invoice",
        "InvoiceLine",
        "InvoicePromo",
        "VisitOffers",
        "IssuedCode",
        "OfferPresets",
        "PatientOffers",
        "PatientCode",
        "NewVisitOffers",
        "NewPatientOffer",
        "ApplyPromoCode",
        "NewPayment",
        "Payment",
        "Allocation",
        "TodayMoney",
        "PendingItem",
        "MixItem",
        "PatientNotes",
        "SummaryNote",
        "SummaryContent",
        "VisitNote",
        "NoteSections",
        "PhoneLookup",
        "PhoneMatches",
        "PhoneMatch",
        "FamilyMember",
        "FamilyLink",
        "FamilyLinkChange",
        "MyStats",
        "FamilyList",
        "NewFamilyLink",
        "CollectSummary",
        "CollectUpi",
        "UpiLink",
        "WalkInRequest",
        "FamilyOfFields",
        "NewPatient",
        "DeskConsentFields",
        "Consent",
        "ConsentList",
        "ConsentNotice",
        "ConsentNoticeList",
        "RecordConsent",
        "WithdrawConsent",
        "WalkIn",
        "WalkInConsent",
        "CalendarWalkIn",
        "CalendarWalkInList",
        "SetConsentSignature",
        "QueueDay",
        "StartedVisit",
        "TokenStatusChange",
        "QuickPicks",
        "QuickPick",
        "QuickTextPick",
        "QuickMedicineSet",
        "QuickSetMedicine",
        // Mobile v7 (D1): analytics, expenses, visits and notes, booking, chat, notifications, staff, stock, auth.
        "AcceptInvitation",
        "AddMembers",
        "Addendum",
        "Analytics",
        "Occupancy",
        "ProcedureCategory",
        "ChairHour",
        "WeekdayHour",
        "AnalyticsBucket",
        "AnalyticsBucketRow",
        "AnalyticsChair",
        "AppointmentChanges",
        "Availability",
        "Badges",
        "BookingWarning",
        "PatientOverlap",
        "BusyHour",
        "CategorySpend",
        "ChairUtilization",
        "ChatMessage",
        "ChatAttachment",
        "ChatMessageList",
        "ChatPeer",
        "CheckInRequest",
        "CheckedIn",
        "Conversation",
        "ConversationItem",
        "ConversationList",
        "ConversationMember",
        "ConversationStarted",
        "ErrorDetail",
        "Expense",
        "ExpenseBill",
        "ExpenseCategory",
        "ExpenseList",
        "RecurringExpense",
        "RecurringExpenseList",
        "NewRecurringExpense",
        "RecurringExpenseChange",
        "RecurringCadence",
        "RecurringExpenseStatus",
        "HandledBy",
        "InboxList",
        "InboxMessage",
        "InventoryItem",
        "ItemList",
        "Joined",
        "KeyCount",
        "MarkedRead",
        "Member",
        "MemberBranch",
        "MembersAdded",
        "MoveRefused",
        "MuteBody",
        "NewAppointmentBody",
        "NewChatMessageBody",
        "NewConversationBody",
        "NewExpense",
        "NewNote",
        "NewProcedure",
        "NewRegistration",
        "NewVisit",
        "NewRecall",
        "Recall",
        "RecallList",
        "MissedList",
        "MissedAppointment",
        "ToCollectList",
        "ToCollectItem",
        "DismissRecall",
        "Note",
        "Observation",
        "NoteContent",
        "NoteCorrection",
        "NoteVersions",
        "Notification",
        "NotificationList",
        "NotifiedAppointment",
        "Avatar",
        "ChairTimeSplit",
        "NotifiedLabOrder",
        "VisitSources",
        "NotifiedQueueToken",
        "PatientBreakdown",
        "PatientMix",
        "PaymentList",
        "PendingInvitation",
        "NewInvitation",
        "CreatedInvitation",
        "Roles",
        "Role",
        "RolePermission",
        "Procedure",
        "ProcedureList",
        "ReadUpTo",
        "Reason",
        "RegistrationReceived",
        "SavedAppointment",
        "Staff",
        "StatusChange",
        "StatusChanged",
        "StockLevel",
        "UnreadCount",
        "WalkInBody",
        "WorkFields",
        // Labs: vendors, contacts, orders and items, contact log, reminders and payments.
        "LabBalance",
        "LabContact",
        "LabContactChannel",
        "LabContactLogChannel",
        "LabContactLogEntry",
        "LabContactLogOutcome",
        "LabContactValues",
        "LabOrder",
        "LabTrackerStage",
        "LabReminderChannel",
        "LabReminders",
        "LabRemindersRequest",
        "LabReminderSkipped",
        "LabReminderVendor",
        "LabOrderChanges",
        "LabOrderEvent",
        "LabOrderItem",
        "LabOrderItemChanges",
        "LabOrderList",
        "LabOrderState",
        "LabOrderStatusChange",
        "LabPayment",
        "LabPaymentList",
        "LabPaymentProof",
        "LabReminderQueued",
        "LabTurnaround",
        "LabVendor",
        "LabVendorKind",
        "LabVendorList",
        "LabVendorValues",
        "NewLabOrder",
        "NewLabOrderItem",
        "NewLabPayment",
        // v10: main's finish, visit link and the models its schemas now reference.
        "CloseRequest",
        "CloseQueueStatus",
        "VisitLink",
        // Phase C: the visit summary for the doctor's own WhatsApp.
        "VisitPatientMessage",
        // P2 (visit-story-v2 §1.6): the ticks, live preview, defaults and hand-off count.
        "NewPatientMessage",
        "MessagePreview",
        "HandOff",
        "MessagePrefs",
        "NewMessagePrefs",
        "UiPrefs",
        "NewUiPrefs",
        "SummaryPlanItem",
        "SummaryMedicine",
        "SummaryAftercare",
        "VisitDiscussed",
        "VisitDiscussedOption",
        "VisitOffer",
        "VisitReferral",
        // C5: the patient's answer to their plan (public route; the phones don't call it).
        "PlanResponseRequest",
        "PlanResponse",
        "ShareRequest",
        "FinishRequest",
        "FinishedVisit",
        "FinishPrescription",
        "CompletedVisit",
        "DayMoneyFigures",
        "IssuedPrescription",
        "LabPipelineStage",
        "NotifiedInvoice",
        "NotifiedRecall",
        "PatientMessage",
        "RootCanal",
        "ShareMessage",
        // v10 T6: My tasks.
        "MyTasks",
        "TaskOccurrence",
        "CompleteBody",
        "ProofUploaded",
        "UsageBody",
        // Time off: ask for it, see who is away, decide.
        "TimeOff",
        "TimeOffList",
        "NewTimeOff",
        "TimeOffDecision",
        // Show patient studio layer (slice 2a): usual options for the recorded situations.
        "PresentStudio",
        // Offers (P5-P7): codes, presets, desk apply.
        "RevokePromoCode",
        "PresentPrice",
        "NotifiedPayment",
        "PresentSituation",
        "PresentOption",
        "PresentRange",
        "PresentFinish",
        "PresentLifespan",
        "PresentWaitStage",
    )
val generatedApi = layout.buildDirectory.dir("generated/openapi")

val generateApiModels =
    tasks.register<GenerateTask>("generateApiModels") {
        generatorName.set("kotlin")
        library.set("multiplatform")
        inputSpec.set(rootProject.file("../docs/api/openapi.json").path)
        outputDir.set(generatedApi.map { it.asFile.path })
        packageName.set("com.aarogyam.staff.api")
        modelPackage.set("com.aarogyam.staff.api.model")
        globalProperties.set(
            mapOf(
                "models" to apiModels.joinToString(","),
                "modelDocs" to "false",
                "modelTests" to "false",
            ),
        )
        configOptions.set(
            mapOf(
                "dateLibrary" to "string",
                "enumPropertyNaming" to "UPPERCASE",
                "sourceFolder" to "src/commonMain/kotlin",
            ),
        )
        typeMappings.set(mapOf("object" to "kotlinx.serialization.json.JsonObject"))
        importMappings.set(mapOf("kotlinx.serialization.json.JsonObject" to "kotlinx.serialization.json.JsonObject"))
        cleanupOutput.set(true)
        // utoipa omits some response descriptions, which strict 3.x validation rejects.
        validateSpec.set(false)
    }

kotlin {
    jvmToolchain(17)
    compilerOptions {
        allWarningsAsErrors.set(true)
        freeCompilerArgs.add("-Xexpect-actual-classes")
    }
    android {
        namespace = "com.aarogyam.staff.shared"
        compileSdk =
            libs.versions.android.compileSdk
                .get()
                .toInt()
        minSdk =
            libs.versions.android.minSdk
                .get()
                .toInt()
        compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
        lint {
            warningsAsErrors = true
            abortOnError = true
            disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
        }
        withHostTest { isReturnDefaultValues = true }
    }
    // JVM runs commonTest fast; the iOS targets build the framework the SwiftUI app links.
    jvm { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }
    listOf(iosArm64(), iosSimulatorArm64()).forEach { target ->
        target.binaries.framework {
            baseName = "AarogyamShared"
            isStatic = true
            binaryOption("bundleId", "com.aarogyam.staff.shared")
            // Unprefixed Swift names for the sakalya-mobile types screens use (SessionState, AppTheme).
            export(libs.sakalya.core)
            export(libs.sakalya.auth)
            export(libs.sakalya.design)
        }
    }
    sourceSets {
        commonMain {
            kotlin.srcDir(generateApiModels.map { generatedApi.get().dir("src/commonMain/kotlin") })
            dependencies {
                api(libs.sakalya.core)
                api(libs.sakalya.http)
                api(libs.sakalya.auth)
                api(libs.sakalya.secure.storage)
                api(libs.sakalya.design)
                api(libs.kotlinx.coroutines.core)
                api(libs.kotlinx.datetime)
                api(libs.kotlinx.serialization.json)
            }
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.ktor.client.mock)
        }
        matching { it.name.endsWith("Test") }.configureEach {
            languageSettings.optIn("kotlinx.coroutines.ExperimentalCoroutinesApi")
        }
        all {
            // Generated models mark required fields with @Required.
            languageSettings.optIn("kotlinx.serialization.ExperimentalSerializationApi")
        }
    }
}

// AGP looks for release baseline profiles next to every Kotlin source folder, the generated one
// included, so the release-only profile task must run after the models are generated.
tasks.matching { it.name == "prepareAndroidMainArtProfile" }.configureEach { dependsOn(generateApiModels) }
