const test = require("node:test");
const assert = require("node:assert/strict");
const planner = require("../planner.js");

test("itinerary creates expected number of days", () => {
  const itinerary = planner.buildItinerary({
    city: "Paris",
    totalDays: 3,
    places: [
      { name: "A", score: 4.5 },
      { name: "B", score: 4.7 },
      { name: "C", score: 4.4 },
      { name: "D", score: 4.3 },
    ],
  });

  assert.equal(itinerary.length, 3);
});

test("selected places are distributed and scheduled", () => {
  const itinerary = planner.buildItinerary({
    city: "Tokyo",
    totalDays: 2,
    visitDurationMin: 60,
    transitBufferMin: 10,
    places: [
      { name: "Skytree", score: 4.9 },
      { name: "Asakusa", score: 4.8 },
      { name: "Shibuya", score: 4.7 },
      { name: "Ueno", score: 4.6 },
    ],
  });

  const allVisitItems = itinerary
    .flatMap((d) => d.items)
    .filter((item) => item.type === "visit");
  const allNames = allVisitItems.map((item) => item.title);

  assert.equal(allVisitItems.length, 4);
  assert.deepEqual(new Set(allNames).size, 4);
});

test("formatTime pads hour and minute", () => {
  assert.equal(planner.formatTime(9 * 60 + 5), "09:05");
  assert.equal(planner.formatTime(15 * 60 + 30), "15:30");
});

test("manual places are parsed with country and city context", () => {
  const places = planner.parseManualPlaces(
    "卢浮宫 | Rue de Rivoli | 180\n埃菲尔铁塔",
    "France",
    "Paris"
  );

  assert.equal(places.length, 2);
  assert.equal(places[0].name, "卢浮宫");
  assert.equal(places[0].address, "Rue de Rivoli, Paris, France");
  assert.equal(places[0].durationMin, 180);
  assert.equal(places[1].address, "Paris, France");
});

test("place rows are parsed from grid input", () => {
  const places = planner.parsePlaceRows(
    [
      { name: "卢浮宫", address: "Rue de Rivoli" },
      { name: "埃菲尔铁塔", address: "" },
      { name: "", address: "" },
    ],
    "France",
    "Paris"
  );

  assert.equal(places.length, 2);
  assert.equal(places[0].name, "卢浮宫");
  assert.equal(places[0].address, "Rue de Rivoli, Paris, France");
  assert.equal(places[0].geocodeQuery, "Rue de Rivoli, Paris, France");
  assert.equal(places[1].name, "埃菲尔铁塔");
  assert.equal(places[1].geocodeQuery, "埃菲尔铁塔, Paris, France");
});

test("buildGeocodeQuery prefers place name over generic city address", () => {
  const query = planner.buildGeocodeQuery(
    { name: "埃菲尔铁塔", addressExtra: "" },
    "France",
    "Paris"
  );
  assert.equal(query, "埃菲尔铁塔, Paris, France");
});

test("route stops keeps day and visit sequence", () => {
  const itinerary = [
    {
      day: 1,
      items: [
        { type: "visit", title: "A", address: "addr-a", startTime: "09:00" },
        { type: "meal", title: "午餐休息", startTime: "12:00" },
        { type: "visit", title: "B", address: "addr-b", startTime: "14:00" },
      ],
    },
    {
      day: 2,
      items: [
        { type: "visit", title: "C", address: "addr-c", startTime: "09:30" },
      ],
    },
  ];

  const stops = planner.buildRouteStops(itinerary);
  assert.deepEqual(stops.map((s) => s.title), ["A", "B", "C"]);
  assert.deepEqual(stops.map((s) => s.day), [1, 1, 2]);
});

test("place specific duration overrides default duration", () => {
  const itinerary = planner.buildItinerary({
    city: "Beijing",
    totalDays: 1,
    visitDurationMin: 90,
    places: [
      { name: "故宫", score: 5, suggestedDurationMin: 240 },
      { name: "景山公园", score: 4.5, suggestedDurationMin: 60 },
    ],
  });

  const visits = itinerary[0].items.filter((item) => item.type === "visit");
  assert.equal(visits[0].durationMin, 240);
  assert.equal(visits[0].startTime, "13:00");
  assert.equal(visits[0].endTime, "17:00");
});
