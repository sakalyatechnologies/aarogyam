# Play Console answers (Aarogyam staff app)

Paste these into Play Console > App content. They match the iOS review notes (`metadata/ios/review_information/notes.txt`).
Items marked **(founder)** must be confirmed before you submit.

## App access
- "All or some functionality is restricted": yes.
- Instructions: "Tap 'Use a password' on the sign-in screen. Normal sign-in sends a one-time email code. The demo account owns a demo clinic with made-up patients only."
- Username: the contents of `metadata/ios/review_information/demo_user.txt`. Password: the git-ignored `demo_password.txt`. Never commit it.

## Ads
- Contains ads: no.

## Content rating (IARC questionnaire)
- Category: "Reference, News, or Educational". If that doesn't fit, "All other app types".
- Violence, sexuality, language, controlled substances, gambling: all no.
- Users interact or share content: no. Staff only see their own clinic.
- Shares location: no. Digital purchases: no.
- Expected rating: Everyone / PEGI 3.

## Target audience and content
- Age groups: 18 and over only.
- Appeals to children: no.

## Health apps declaration
- Features: "Medical: clinical record management / electronic health records for healthcare providers" and "Practice management (appointments, billing)".
- It is not a medical device, gives no diagnosis or treatment advice, and every entry is written by the clinic's doctor.
- Users: licensed clinics and their staff, by invitation. There is no public sign-up.

## Data safety
- Collects or shares user data: yes (collects). Shares with third parties: no (founder confirmed 2026-11-23). Processors acting for us (Supabase, Google Cloud, Cloudflare, Resend, Firebase) are service providers, which Play does not count as sharing.
- Encrypted in transit: yes (HTTPS only).
- Users can request deletion: yes, in the app at More > Delete account. Clinic records stay with the clinic, as health-record law requires.
- Data is stored in India and never shared (founder confirmed 2026-11-23).

| Data type | Collected | Purpose | Optional |
|---|---|---|---|
| Personal info: name, email, phone (staff, and patients entered by staff) | yes | App functionality, account management | no |
| Health info (visit notes, prescriptions, dental charts) | yes | App functionality | no |
| Photos (patient photos, X-rays) | yes | App functionality | yes |
| Audio (dictation; processed on device, never stored) | no (not stored or sent as audio) | — | — |
| Financial info (payments recorded by the clinic; no card data) | yes, purchase history | App functionality | no |
| App activity / app interactions (Firebase Analytics, no patient data) | yes | Analytics | no |
| Crash logs and diagnostics (Crashlytics) | yes | Analytics, app functionality | no |
| Device or other IDs (Firebase installation ID, FCM push token) | yes | App functionality (alerts), analytics | no |
| Location, contacts, messages, web history, advertising ID | no | — | — |

## Government / financial / news declarations
- Government app: no. Financial features: no (the app records payments taken outside it). News: no.

## Store settings
- Category: Medical. Tags: Medical, Business, Productivity.
- Contact email: the same as `metadata/ios/review_information/email_address.txt`. Privacy policy: the URL used for iOS.
