// Explicit reference-data seed. It is never imported by the application and
// must be run manually; it does not create users or authentication records.
const { withTransaction } = require("../config/postgres");
const providers = [
  ["indrive","inDrive","https://indrive.com"],
  ["quickride","Yango","https://quickride.example.com"],
  ["urbancab","Bykea","https://urbancab.example.com"],
];
const rates = {
  indrive: { bike:[60,20,1,120,1.05], rickshaw:[80,28,1.4,150,1.05], mini:[100,34,1.8,200,1.05], car:[120,42,2.2,250,1.05] },
  quickride: { bike:[50,18,1,110,1], rickshaw:[70,25,1.3,140,1], mini:[90,30,1.6,190,1], car:[110,38,2,230,1] },
  urbancab: { bike:[70,22,1.2,130,1.1], rickshaw:[90,30,1.6,160,1.1], mini:[110,38,2,210,1.1], car:[130,48,2.6,270,1.1] },
};
async function seedDatabase(){return withTransaction(async client=>{for(const [name,display,link] of providers){const p=(await client.query("INSERT INTO providers(name,display_name,is_active,deep_link_url) VALUES($1,$2,true,$3) ON CONFLICT(name) DO UPDATE SET display_name=excluded.display_name,deep_link_url=excluded.deep_link_url RETURNING id",[name,display,link])).rows[0];for(const [vehicle,[base,km,min,minimum,surge]] of Object.entries(rates[name]))await client.query("INSERT INTO vehicle_rates(provider_id,vehicle_type,base_fare,per_km_rate,per_min_rate,minimum_fare,surge_multiplier) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(provider_id,vehicle_type) DO UPDATE SET base_fare=excluded.base_fare,per_km_rate=excluded.per_km_rate,per_min_rate=excluded.per_min_rate,minimum_fare=excluded.minimum_fare,surge_multiplier=excluded.surge_multiplier",[p.id,vehicle,base,km,min,minimum,surge]);}});}
if(require.main===module)seedDatabase().then(()=>console.log("PostgreSQL reference data seeded")).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={seedDatabase};
