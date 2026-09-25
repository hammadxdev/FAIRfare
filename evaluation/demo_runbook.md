# Fair Fare Version 1 Demo Runbook

1. Start the backend in the default simulated provider mode:
   `INDRIVE_MODE=simulated`, with seeded providers and a writable `DB_PATH`.
2. Start Expo with `EXPO_PUBLIC_API_BASE_URL` pointing at the backend.
3. Register or login.
4. Set a typical budget of `PKR 600`, preferred vehicle `RICKSHAW`, and avoid
   `BIKE` in Settings.
5. On Home, select pickup and destination, select a vehicle, and compare.
6. On Results, show the current provider quotes, Expected Fare, simulated-model
   disclosure, Book/Wait insight, and Recommended for You.
7. Select Ask AI about these rides and ask:
   `I have Rs. 600 and don't want a bike.`
8. Open History, inspect the snapshot, and use Compare Again.
9. Explain that real provider APIs are postponed and all demo quotes and model
   training data are simulated.

The AI response requires backend AI configuration for live natural-language
answers. Without it, the unavailable state is intentional and the rest of the
demo remains usable.
