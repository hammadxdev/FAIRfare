const db = require("../config/database");

const providers = [
  {
    name: "ridego",
    display_name: "RideGo",
    logo_url: null,
    deep_link_url: "https://ridego.example.com",
  },
  {
    name: "quickride",
    display_name: "QuickRide",
    logo_url: null,
    deep_link_url: "https://quickride.example.com",
  },
  {
    name: "urbancab",
    display_name: "UrbanCab",
    logo_url: null,
    deep_link_url: "https://urbancab.example.com",
  },
];

// baseFare, perKmRate, perMinRate, minimumFare, surgeMultiplier per provider/vehicleType
const rates = {
  ridego: {
    bike: { base_fare: 60, per_km_rate: 20, per_min_rate: 1.0, minimum_fare: 120, surge_multiplier: 1.05 },
    rickshaw: { base_fare: 80, per_km_rate: 28, per_min_rate: 1.4, minimum_fare: 150, surge_multiplier: 1.05 },
    mini: { base_fare: 100, per_km_rate: 34, per_min_rate: 1.8, minimum_fare: 200, surge_multiplier: 1.05 },
    car: { base_fare: 120, per_km_rate: 42, per_min_rate: 2.2, minimum_fare: 250, surge_multiplier: 1.05 },
  },
  quickride: {
    bike: { base_fare: 50, per_km_rate: 18, per_min_rate: 1.0, minimum_fare: 110, surge_multiplier: 1.0 },
    rickshaw: { base_fare: 70, per_km_rate: 25, per_min_rate: 1.3, minimum_fare: 140, surge_multiplier: 1.0 },
    mini: { base_fare: 90, per_km_rate: 30, per_min_rate: 1.6, minimum_fare: 190, surge_multiplier: 1.0 },
    car: { base_fare: 110, per_km_rate: 38, per_min_rate: 2.0, minimum_fare: 230, surge_multiplier: 1.0 },
  },
  urbancab: {
    bike: { base_fare: 70, per_km_rate: 22, per_min_rate: 1.2, minimum_fare: 130, surge_multiplier: 1.1 },
    rickshaw: { base_fare: 90, per_km_rate: 30, per_min_rate: 1.6, minimum_fare: 160, surge_multiplier: 1.1 },
    mini: { base_fare: 110, per_km_rate: 38, per_min_rate: 2.0, minimum_fare: 210, surge_multiplier: 1.1 },
    car: { base_fare: 130, per_km_rate: 48, per_min_rate: 2.6, minimum_fare: 270, surge_multiplier: 1.1 },
  },
};

function seedDatabase() {
  const existingProviders = db.prepare("SELECT COUNT(*) AS count FROM providers").get();

  if (existingProviders.count > 0) {
    console.log("Database already seeded");
    return;
  }

  const insertProvider = db.prepare(`
    INSERT INTO providers (name, display_name, is_active, logo_url, deep_link_url)
    VALUES (@name, @display_name, 1, @logo_url, @deep_link_url)
  `);

  const getProviderId = db.prepare(`SELECT id FROM providers WHERE name = ?`);

  const insertRate = db.prepare(`
    INSERT INTO vehicle_rates
      (provider_id, vehicle_type, base_fare, per_km_rate, per_min_rate, minimum_fare, surge_multiplier)
    VALUES (@provider_id, @vehicle_type, @base_fare, @per_km_rate, @per_min_rate, @minimum_fare, @surge_multiplier)
  `);

  const seedAll = db.transaction(() => {
    for (const provider of providers) {
      insertProvider.run(provider);
      const { id } = getProviderId.get(provider.name);

      const vehicleRates = rates[provider.name];
      for (const vehicleType of Object.keys(vehicleRates)) {
        insertRate.run({
          provider_id: id,
          vehicle_type: vehicleType,
          ...vehicleRates[vehicleType],
        });
      }
    }
  });

  seedAll();
  console.log("Database seed completed");
}

if (require.main === module) {
  seedDatabase();
}

module.exports = {
  seedDatabase,
};
