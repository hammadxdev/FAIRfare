# Fair Fare provider/city coverage report

Checked: 2026-10-13. This is a research register, not a claim of live driver availability. Every row remains `reviewer_approved=false` and `production_enabled=false`.

## Internal provider mapping

| Internal ID | Display name | Dataset label | Basis |
|---|---|---|---|
| `indrive` | inDrive | inDrive | `src/db/seed.js`, provider registry |
| `quickride` | Yango | Yango | `src/db/seed.js`, provider registry |
| `urbancab` | Bykea | Bykea | `src/db/seed.js`, provider registry |

These identifiers are preserved. `quickride` and `urbancab` are compatibility IDs, not evidence that the services are named QuickRide or UrbanCab.

## Evidence interpretation

- Yango's official Pakistan rider page lists Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad and Multan and advertises Economy, Comfort, Bike and Rickshaw: <https://yango.com/rur_pk/rider/>. The official Multan launch is dated 2025-05-23: <https://yango.com/en_int/news/no-bargains-just-better-rides-yango-launches-in-multan-with-safer-affordable-mobility>.
- Bykea's current Pakistan page lists rides on motorbikes, rickshaws and cars in Karachi, Lahore and Islamabad: <https://www.bykea.com/pk/>. Its Rawalpindi office listing is not treated as current ride coverage. Older Bykea material mentions Rawalpindi, so that city is `REVIEW_REQUIRED`, not automatically enabled: <https://bykea.com/seriesbd/>.
- inDrive's official Pakistan blog says it grew from Islamabad/Rawalpindi to 11 cities but does not enumerate those 11: <https://blog.indrive.com/en-np/article/indrive-turns-two-in-pakistan>. A separate official airport-feature page names Lahore, Islamabad/Rawalpindi and Karachi for that feature only: <https://blog.indrive.com/en-ci/article/you-ve-arrived-our-airport-feature-is-here-to-greet-you>. Those rows are `REVIEW_REQUIRED` and zone-specific, not city-wide confirmation.

Status meanings follow the project policy. `NOT_LISTED` means no qualifying official listing was found; it is not confirmed unsupported.

| City ID | City/locality | inDrive | Yango | Bykea |
|---|---|---|---|---|
| PK001 | Lahore | REVIEW_REQUIRED / airport feature / medium | OFFICIAL_LISTED / high | OFFICIAL_LISTED / high |
| PK002 | Karachi | REVIEW_REQUIRED / airport feature / medium | OFFICIAL_LISTED / high | OFFICIAL_LISTED / high |
| PK003 | Islamabad | REVIEW_REQUIRED / airport feature / medium | OFFICIAL_LISTED / high | OFFICIAL_LISTED / high |
| PK004 | Rawalpindi | REVIEW_REQUIRED / airport feature / medium | OFFICIAL_LISTED / high | REVIEW_REQUIRED / historical + office evidence / medium |
| PK005 | Faisalabad | UNVERIFIED / no enumerated official city claim | OFFICIAL_LISTED / high | NOT_LISTED |
| PK006 | Multan | UNVERIFIED / no enumerated official city claim | OFFICIAL_LISTED / dated launch + city page / high | NOT_LISTED |
| PK007 | Hyderabad | UNVERIFIED | NOT_LISTED | NOT_LISTED |
| PK008 | Peshawar | UNVERIFIED | NOT_LISTED | NOT_LISTED |
| PK009 | Sialkot | UNVERIFIED | NOT_LISTED | NOT_LISTED |
| PK010 | Sahiwal | UNVERIFIED | NOT_LISTED | NOT_LISTED |
| PK011 | Abbottabad | UNVERIFIED | NOT_LISTED | NOT_LISTED |
| PK012 | Gujranwala | UNVERIFIED | NOT_LISTED | NOT_LISTED |
| PK013 | Larkana | UNVERIFIED | NOT_LISTED | NOT_LISTED |
| PK014 | Kamoke | UNVERIFIED | NOT_LISTED | NOT_LISTED |
| PK015 | Sheikhupura | UNVERIFIED | NOT_LISTED | NOT_LISTED |
| PK016 | Hafizabad | UNVERIFIED | NOT_LISTED | NOT_LISTED |
| PK017 | Okara | UNVERIFIED | NOT_LISTED | NOT_LISTED |
| PK018 | Wah | UNVERIFIED | NOT_LISTED | NOT_LISTED |
| PK019 | Taxila | UNVERIFIED | NOT_LISTED | NOT_LISTED |
| PK020 | Quetta | UNVERIFIED | NOT_LISTED | NOT_LISTED |
| PK021 | Raiwind | UNVERIFIED | NOT_LISTED | NOT_LISTED |

## Normalization and intercity policy

The 21 dataset names remain separate canonical IDs. Wah, Taxila and Raiwind are not merged into Islamabad, Rawalpindi or Lahore without a provider source that explicitly defines the service area. Islamabad and Rawalpindi are separate rows even where a source uses `Islamabad/Rawalpindi`. City coverage never establishes intercity-trip coverage; the backend keeps intercity requests fail-closed in verified mode.

## Production decision

No row is currently eligible for verified-mode production. Website listing is evidence for review, not automatic approval. A reviewer must confirm the exact pickup service area and app-selectable category before setting the approval and production flags in the evidence register.
