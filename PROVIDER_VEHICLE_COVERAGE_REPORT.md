# Provider × city × vehicle coverage report

Checked: 2026-10-13. This matrix records evidence and mapping review state only. No row is approved for production.

Fair Fare internal categories are `BIKE`, `RICKSHAW`, `ECONOMY_CAR`, `STANDARD_CAR` and `PREMIUM_CAR` (see `src/services/vehicleType.service.js`). `STANDARD_CAR` is the internal category for the existing `car`/Ride AC class; `PREMIUM_CAR` is the existing Premium class. A provider's generic “cars” claim does not establish Economy, Comfort or Premium.

Legend: `O` = OFFICIAL_LISTED service and direct mapping; `R` = REVIEW_REQUIRED mapping or city boundary; `U` = UNVERIFIED; `N` = NOT_LISTED. None is production-enabled.

## inDrive

No reviewed official source enumerates inDrive vehicle categories by candidate city. The airport-feature source is zone-specific and does not establish vehicle classes. All five categories therefore remain unverified.

| City | Bike | Rickshaw | Economy car | Standard/Comfort car | Premium car |
|---|---|---|---|---|---|
| Lahore | U | U | U | U | U |
| Karachi | U | U | U | U | U |
| Islamabad | U | U | U | U | U |
| Rawalpindi | U | U | U | U | U |
| Faisalabad | U | U | U | U | U |
| Multan | U | U | U | U | U |
| Hyderabad | U | U | U | U | U |
| Peshawar | U | U | U | U | U |
| Sialkot | U | U | U | U | U |
| Sahiwal | U | U | U | U | U |
| Abbottabad | U | U | U | U | U |
| Gujranwala | U | U | U | U | U |
| Larkana | U | U | U | U | U |
| Kamoke | U | U | U | U | U |
| Sheikhupura | U | U | U | U | U |
| Hafizabad | U | U | U | U | U |
| Okara | U | U | U | U | U |
| Wah | U | U | U | U | U |
| Taxila | U | U | U | U | U |
| Quetta | U | U | U | U | U |
| Raiwind | U | U | U | U | U |

## Yango

Yango's official Pakistan rider page lists Economy, Comfort, Bike and Rickshaw. Bike, Rickshaw and Economy map directly; Comfort → `STANDARD_CAR` is marked review-required because the provider class is not identical to Fair Fare's internal class. Premium is not listed in the reviewed source.

| City | Bike | Rickshaw | Economy car | Standard/Comfort car | Premium car |
|---|---|---|---|---|---|
| Lahore | O | O | O | R | U |
| Karachi | O | O | O | R | U |
| Islamabad | O | O | O | R | U |
| Rawalpindi | O | O | O | R | U |
| Faisalabad | O | O | O | R | U |
| Multan | O | O | O | R | U |
| Hyderabad | N | N | N | N | N |
| Peshawar | N | N | N | N | N |
| Sialkot | N | N | N | N | N |
| Sahiwal | N | N | N | N | N |
| Abbottabad | N | N | N | N | N |
| Gujranwala | N | N | N | N | N |
| Larkana | N | N | N | N | N |
| Kamoke | N | N | N | N | N |
| Sheikhupura | N | N | N | N | N |
| Hafizabad | N | N | N | N | N |
| Okara | N | N | N | N | N |
| Wah | N | N | N | N | N |
| Taxila | N | N | N | N | N |
| Quetta | N | N | N | N | N |
| Raiwind | N | N | N | N | N |

## Bykea

Bykea's current Pakistan page names motorbikes, rickshaws and cars in Karachi, Lahore and Islamabad. Motorbike and rickshaw map directly. Generic car → `STANDARD_CAR` requires review; it does not prove Economy, Comfort or Premium. Rawalpindi has historical operational material but no current category evidence, so all mappings remain review-required.

| City | Bike | Rickshaw | Economy car | Standard/Car | Premium car |
|---|---|---|---|---|---|
| Lahore | O | O | U | R | U |
| Karachi | O | O | U | R | U |
| Islamabad | O | O | U | R | U |
| Rawalpindi | R | R | R | R | R |
| Faisalabad | N | N | N | N | N |
| Multan | N | N | N | N | N |
| Hyderabad | N | N | N | N | N |
| Peshawar | N | N | N | N | N |
| Sialkot | N | N | N | N | N |
| Sahiwal | N | N | N | N | N |
| Abbottabad | N | N | N | N | N |
| Gujranwala | N | N | N | N | N |
| Larkana | N | N | N | N | N |
| Kamoke | N | N | N | N | N |
| Sheikhupura | N | N | N | N | N |
| Hafizabad | N | N | N | N | N |
| Okara | N | N | N | N | N |
| Wah | N | N | N | N | N |
| Taxila | N | N | N | N | N |
| Quetta | N | N | N | N | N |
| Raiwind | N | N | N | N | N |

Sources: Yango <https://yango.com/rur_pk/rider/>; Bykea <https://www.bykea.com/pk/> and historical Rawalpindi context <https://bykea.com/seriesbd/>. These sources do not replace dated app confirmation.
