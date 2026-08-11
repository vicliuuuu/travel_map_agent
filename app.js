 (function () {
  "use strict";

  var state = {
    places: [],
    llmInsights: {},
    layoutMode: "input",
    lastRoadbookExport: null,
    mapReady: false,
    mapLoading: false,
    map: null,
    geocoder: null,
    directionsService: null,
    routeRenderers: [],
    transitRenderers: [],
    routeMarkers: [],
    currentRouteStops: [],
    routeMode: "driving",
    transitComputed: false,
    transitMissingCount: 0,
  };

  var ui = {
    layoutRoot: document.getElementById("mainLayout"),
    destinationsRoot: document.getElementById("destinationsRoot"),
    addCountryBtn: document.getElementById("addCountryBtn"),
    apiKeyInput: document.getElementById("apiKeyInput"),
    connectMapBtn: document.getElementById("connectMapBtn"),
    markMapBtn: document.getElementById("markMapBtn"),
    llmBaseUrlInput: document.getElementById("llmBaseUrlInput"),
    llmApiKeyInput: document.getElementById("llmApiKeyInput"),
    llmProviderInput: document.getElementById("llmProviderInput"),
    llmModelSelect: document.getElementById("llmModelSelect"),
    llmAnalyzeBtn: document.getElementById("llmAnalyzeBtn"),
    agentPlanBtn: document.getElementById("agentPlanBtn"),
    planProgressWrap: document.getElementById("planProgressWrap"),
    planProgressStage: document.getElementById("planProgressStage"),
    planProgressPercent: document.getElementById("planProgressPercent"),
    planProgressFill: document.getElementById("planProgressFill"),
    downloadRoadbookBtn: document.getElementById("downloadRoadbookBtn"),
    daysInput: document.getElementById("daysInput"),
    visitMinutesInput: document.getElementById("visitMinutesInput"),
    strategySelect: document.getElementById("strategySelect"),
    transportSelect: document.getElementById("transportSelect"),
    physicalSelect: document.getElementById("physicalSelect"),
    statusText: document.getElementById("statusText"),
    placesList: document.getElementById("placesList"),
    itineraryResult: document.getElementById("itineraryResult"),
    routeModeToggle: document.getElementById("routeModeToggle"),
    routeModeDrivingBtn: document.getElementById("routeModeDrivingBtn"),
    routeModeTransitBtn: document.getElementById("routeModeTransitBtn"),
  };

  var ITINERARY_PLACEHOLDER =
    "<p class=\"itinerary-placeholder\">填写 LLM 配置并点击「Agent 智能规划」后，路书将显示在这里。</p>";

  function primaryDestination(destinations) {
    var firstCountry = destinations[0] || {};
    var firstCity = (firstCountry.cities || [])[0] || {};
    return {
      country: String(firstCountry.country || "").trim(),
      city: String(firstCity.city || "").trim(),
    };
  }

  function pickLlmModelValue() {
    var selectedModel = ui.llmModelSelect.value.trim();
    if (!selectedModel) {
      return "";
    }
    return selectedModel;
  }

  function updateModelSelectOptions(models, currentModel) {
    ui.llmModelSelect.innerHTML = "";
    if (!models.length) {
      var emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "请手动输入模型";
      ui.llmModelSelect.appendChild(emptyOption);
      return;
    }

    models.forEach(function (modelName) {
      var option = document.createElement("option");
      option.value = modelName;
      option.textContent = modelName;
      if (currentModel && currentModel === modelName) {
        option.selected = true;
      }
      ui.llmModelSelect.appendChild(option);
    });
  }

  function refreshProviderAndModelByBaseUrl() {
    if (!window.TravelLlm) {
      return;
    }
    var providerInfo = window.TravelLlm.detectProviderByBaseUrl(ui.llmBaseUrlInput.value);
    ui.llmProviderInput.value = providerInfo.provider;

    var models = window.TravelLlm.getProviderModels(providerInfo.provider);
    var currentSelected = pickLlmModelValue();
    updateModelSelectOptions(models, currentSelected);

  }

  function updateStatus(text, isError) {
    ui.statusText.textContent = text;
    ui.statusText.style.borderColor = isError ? "#fecaca" : "#bfdbfe";
    ui.statusText.style.background = isError ? "#fef2f2" : "#eff6ff";
  }

  function setLayoutMode(mode) {
    var nextMode = mode || "map";
    state.layoutMode = nextMode;
    if (!ui.layoutRoot) {
      return;
    }
    ui.layoutRoot.classList.remove("mode-input-focus", "mode-map-focus", "mode-roadbook-focus");
    if (nextMode === "input") {
      ui.layoutRoot.classList.add("mode-input-focus");
      return;
    }
    if (nextMode === "roadbook") {
      ui.layoutRoot.classList.add("mode-roadbook-focus");
      return;
    }
    ui.layoutRoot.classList.add("mode-map-focus");
  }

  function setPlanProgressVisible(visible) {
    if (visible) {
      ui.planProgressWrap.classList.remove("hidden");
    } else {
      ui.planProgressWrap.classList.add("hidden");
    }
  }

  function updatePlanProgress(percent, stageText) {
    var safePercent = Number(percent);
    if (!Number.isFinite(safePercent)) {
      safePercent = 0;
    }
    safePercent = Math.max(0, Math.min(100, Math.round(safePercent)));
    ui.planProgressFill.style.width = safePercent + "%";
    ui.planProgressPercent.textContent = safePercent + "%";
    ui.planProgressStage.textContent = stageText || "处理中...";
  }

  function setPlanningLoading(isLoading) {
    ui.agentPlanBtn.disabled = Boolean(isLoading);
    ui.llmAnalyzeBtn.disabled = Boolean(isLoading);
    ui.markMapBtn.disabled = Boolean(isLoading);
  }

  function clearRouteOverlays() {
    state.routeRenderers.forEach(function (renderer) {
      renderer.setMap(null);
    });
    state.routeRenderers = [];

    state.transitRenderers.forEach(function (overlay) {
      overlay.setMap(null);
    });
    state.transitRenderers = [];

    state.routeMarkers.forEach(function (marker) {
      marker.setMap(null);
    });
    state.routeMarkers = [];

    state.currentRouteStops = [];
    state.transitComputed = false;
    state.transitMissingCount = 0;
    state.routeMode = "driving";
    showRouteModeToggle(false);
  }

  function showRouteModeToggle(visible) {
    if (!ui.routeModeToggle) {
      return;
    }
    ui.routeModeToggle.classList.toggle("hidden", !visible);
  }

  function updateRouteModeButtons() {
    var isTransit = state.routeMode === "transit";
    if (ui.routeModeDrivingBtn) {
      ui.routeModeDrivingBtn.classList.toggle("active", !isTransit);
    }
    if (ui.routeModeTransitBtn) {
      ui.routeModeTransitBtn.classList.toggle("active", isTransit);
    }
  }

  // 只切换显隐，不重新计算：自驾图层与公交图层各自持有 setMap 能力（DirectionsRenderer / Polyline 均支持）。
  function applyRouteModeVisibility() {
    var showDriving = state.routeMode !== "transit";
    state.routeRenderers.forEach(function (overlay) {
      overlay.setMap(showDriving ? state.map : null);
    });
    state.transitRenderers.forEach(function (overlay) {
      overlay.setMap(showDriving ? null : state.map);
    });
  }

  function requestTransitDirections(from, to) {
    return new Promise(function (resolve, reject) {
      state.directionsService.route(
        {
          origin: from.latLng,
          destination: to.latLng,
          travelMode: google.maps.TravelMode.TRANSIT,
        },
        function (result, status) {
          if (status !== "OK") {
            reject(new Error(status));
            return;
          }
          resolve(result);
        }
      );
    });
  }

  // 公交路线：transit 模式不支持途经点，故相邻两点逐段查询；无公交数据的段落用灰色虚线兜底，避免断线。
  async function drawTransitRoute(stops) {
    var overlays = [];
    var missing = 0;
    var i;
    for (i = 1; i < stops.length; i += 1) {
      var from = stops[i - 1];
      var to = stops[i];
      try {
        var result = await requestTransitDirections(from, to);
        var renderer = new google.maps.DirectionsRenderer({
          map: null,
          suppressMarkers: true,
          preserveViewport: true,
          polylineOptions: {
            strokeColor: "#059669",
            strokeOpacity: 0.9,
            strokeWeight: 5,
          },
        });
        renderer.setDirections(result);
        overlays.push(renderer);
      } catch (err) {
        missing += 1;
        var dashed = new google.maps.Polyline({
          map: null,
          path: [from.latLng, to.latLng],
          strokeOpacity: 0,
          icons: [
            {
              icon: {
                path: "M 0,-1 0,1",
                strokeColor: "#94a3b8",
                strokeOpacity: 1,
                strokeWeight: 2,
                scale: 3,
              },
              offset: "0",
              repeat: "12px",
            },
          ],
        });
        overlays.push(dashed);
      }
    }
    state.transitRenderers = overlays;
    state.transitComputed = true;
    state.transitMissingCount = missing;
  }

  async function setRouteMode(mode) {
    if (mode !== "driving" && mode !== "transit") {
      return;
    }
    if (!state.mapReady || state.currentRouteStops.length < 2) {
      return;
    }
    if (mode === state.routeMode && (mode !== "transit" || state.transitComputed)) {
      return;
    }
    if (mode === "transit" && !state.transitComputed) {
      updateStatus("正在计算公交路线（逐段查询，请稍候）...", false);
      if (ui.routeModeTransitBtn) {
        ui.routeModeTransitBtn.disabled = true;
      }
      try {
        await drawTransitRoute(state.currentRouteStops);
      } catch (err) {
        updateStatus("公交路线计算失败: " + err.message, true);
        return;
      } finally {
        if (ui.routeModeTransitBtn) {
          ui.routeModeTransitBtn.disabled = false;
        }
      }
    }
    state.routeMode = mode;
    applyRouteModeVisibility();
    updateRouteModeButtons();
    if (mode === "transit") {
      var missing = state.transitMissingCount || 0;
      updateStatus(
        missing > 0
          ? ("已切换到公交路线；其中 " + missing + " 段无公交数据，用灰色虚线示意。")
          : "已切换到公交路线。",
        false
      );
    } else {
      updateStatus("已切换到自驾路线。", false);
    }
  }

  function createPlaceRow(nameValue, addressValue, placeTypeValue) {
    var row = document.createElement("div");
    row.className = "places-grid-row place-row";
    row.innerHTML =
      "<span class=\"col-index place-row-index\"></span>" +
      "<input type=\"text\" class=\"place-name-input\" placeholder=\"点位名称\" />" +
      "<input type=\"text\" class=\"place-address-input\" placeholder=\"详细地址（可选）\" />" +
      "<select class=\"place-type-select\"><option value=\"scenic\">景点</option><option value=\"hotel\">酒店</option></select>" +
      "<button type=\"button\" class=\"btn-icon btn-remove-place\">×</button>";
    row.querySelector(".place-name-input").value = nameValue || "";
    row.querySelector(".place-address-input").value = addressValue || "";
    row.querySelector(".place-type-select").value = placeTypeValue === "hotel" ? "hotel" : "scenic";
    return row;
  }

  function createCityBlock(cityValue) {
    var cityBlock = document.createElement("section");
    cityBlock.className = "destination-city";
    cityBlock.innerHTML =
      "<div class=\"destination-row\">" +
      "<label>城市<input type=\"text\" class=\"city-input\" placeholder=\"例如：Beijing\" /></label>" +
      "<button type=\"button\" class=\"btn-secondary btn-remove-city\">删除城市</button>" +
      "</div>" +
      "<div class=\"places-grid\">" +
      "<div class=\"places-grid-header\">" +
      "<span class=\"col-index\">#</span><span class=\"col-name\">点位名</span><span class=\"col-address\">地址（可选）</span><span class=\"col-type\">酒店锚点</span><span class=\"col-action\"></span>" +
      "</div>" +
      "<div class=\"city-places-grid-body\"></div>" +
      "</div>" +
      "<button type=\"button\" class=\"btn-secondary btn-add-place\">+ 添加点位</button>";
    cityBlock.querySelector(".city-input").value = cityValue || "";
    return cityBlock;
  }

  function createCountryBlock(countryValue) {
    var countryBlock = document.createElement("section");
    countryBlock.className = "destination-country";
    countryBlock.innerHTML =
      "<div class=\"destination-row\">" +
      "<label>国家/地区<input type=\"text\" class=\"country-input\" placeholder=\"例如：China\" /></label>" +
      "<button type=\"button\" class=\"btn-secondary btn-remove-country\">删除国家</button>" +
      "</div>" +
      "<div class=\"country-cities\"></div>" +
      "<button type=\"button\" class=\"btn-secondary btn-add-city\">+ 添加城市</button>";
    countryBlock.querySelector(".country-input").value = countryValue || "";
    return countryBlock;
  }

  function refreshPlaceIndexesWithinCity(cityBlock) {
    var rows = cityBlock.querySelectorAll(".place-row");
    rows.forEach(function (row, index) {
      row.querySelector(".place-row-index").textContent = String(index + 1);
    });
  }

  function addPlaceRowToCity(cityBlock, nameValue, addressValue, placeTypeValue) {
    var body = cityBlock.querySelector(".city-places-grid-body");
    body.appendChild(createPlaceRow(nameValue, addressValue, placeTypeValue));
    refreshPlaceIndexesWithinCity(cityBlock);
  }

  function addCityToCountry(countryBlock, cityValue) {
    var city = createCityBlock(cityValue);
    countryBlock.querySelector(".country-cities").appendChild(city);
    addPlaceRowToCity(city, "", "", false);
  }

  function addCountry(countryValue) {
    var countryBlock = createCountryBlock(countryValue);
    ui.destinationsRoot.appendChild(countryBlock);
    addCityToCountry(countryBlock, "");
  }

  function collectDestinationsFromUI() {
    var countryBlocks = ui.destinationsRoot.querySelectorAll(".destination-country");
    return Array.prototype.map.call(countryBlocks, function (countryBlock) {
      var country = countryBlock.querySelector(".country-input").value.trim();
      var cityBlocks = countryBlock.querySelectorAll(".destination-city");
      var cities = Array.prototype.map.call(cityBlocks, function (cityBlock) {
        var city = cityBlock.querySelector(".city-input").value.trim();
        var rows = cityBlock.querySelectorAll(".place-row");
        var places = Array.prototype.map.call(rows, function (row) {
          var placeType = row.querySelector(".place-type-select").value === "hotel" ? "hotel" : "scenic";
          return {
            name: row.querySelector(".place-name-input").value.trim(),
            address: row.querySelector(".place-address-input").value.trim(),
            isHotel: placeType === "hotel",
            type: placeType,
          };
        }).filter(function (place) {
          return place.name || place.address;
        });
        return {
          city: city,
          places: places,
        };
      }).filter(function (cityBlockData) {
        return cityBlockData.city || cityBlockData.places.length;
      });
      return {
        country: country,
        cities: cities,
      };
    }).filter(function (countryBlockData) {
      return countryBlockData.country || countryBlockData.cities.length;
    });
  }

  function splitLodgingFromPlaces(flatPlaces) {
    var places = Array.isArray(flatPlaces) ? flatPlaces : [];
    var hotelCandidate = null;
    var nonHotelPlaces = [];
    places.forEach(function (place) {
      if (place.isHotel && !hotelCandidate) {
        hotelCandidate = place;
        return;
      }
      nonHotelPlaces.push(place);
    });
    var lodging = null;
    if (hotelCandidate) {
      lodging = {
        mode: "single",
        hotel: {
          name: hotelCandidate.name || "酒店",
          address: hotelCandidate.addressExtra || hotelCandidate.address || "",
          checkInDate: "",
          checkOutDate: "",
        },
      };
    }
    return {
      lodging: lodging,
      places: nonHotelPlaces,
    };
  }

  function collectAllTripInput() {
    var destinations = collectDestinationsFromUI();
    var flatPlaces = window.TravelPlanner.flattenDestinations(destinations);
    var splitResult = splitLodgingFromPlaces(flatPlaces);
    var primary = primaryDestination(destinations);
    return {
      destinations: destinations,
      places: mergePlacesWithLlmInsights(splitResult.places),
      country: primary.country,
      city: primary.city,
      lodging: splitResult.lodging,
      totalDays: Number(ui.daysInput.value),
      visitMinutes: Number(ui.visitMinutesInput.value),
      strategy: ui.strategySelect ? ui.strategySelect.value : "fastest",
      transportPreference: ui.transportSelect ? ui.transportSelect.value : "driving",
      physicalPreference: ui.physicalSelect ? ui.physicalSelect.value : "standard",
    };
  }

  function splitStopsIntoRouteSegments(stops, maxStopsPerSegment) {
    if (!Array.isArray(stops) || stops.length < 2) {
      return [];
    }
    var segments = [];
    var start = 0;
    while (start < stops.length - 1) {
      var end = Math.min(start + maxStopsPerSegment, stops.length);
      segments.push(stops.slice(start, end));
      start = end - 1;
    }
    return segments;
  }

  function geocodePlace(query, countryCode) {
    return new Promise(function (resolve, reject) {
      var request = { address: query };
      if (countryCode) {
        request.componentRestrictions = { country: countryCode.toLowerCase() };
      }

      state.geocoder.geocode(request, function (results, status) {
        if (status !== "OK" || !results || !results[0]) {
          reject(new Error("地理编码失败: " + query + " (" + status + ")"));
          return;
        }
        var first = results[0];
        var location = first.geometry.location;
        resolve({
          latLng: location,
          formattedAddress: first.formatted_address || query,
          lat: location.lat(),
          lng: location.lng(),
        });
      });
    });
  }

  function buildPlaceGeocodeQuery(place, country, city) {
    if (place.geocodeQuery) {
      return place.geocodeQuery;
    }
    return window.TravelPlanner.buildGeocodeQuery(place, country, city);
  }

  function requestDirections(segment) {
    return new Promise(function (resolve, reject) {
      var waypoints = segment.slice(1, -1).map(function (stop) {
        return {
          location: stop.latLng,
          stopover: true,
        };
      });

      state.directionsService.route(
        {
          origin: segment[0].latLng,
          destination: segment[segment.length - 1].latLng,
          waypoints: waypoints,
          optimizeWaypoints: false,
          travelMode: google.maps.TravelMode.DRIVING,
        },
        function (result, status) {
          if (status !== "OK") {
            reject(new Error("路线规划失败: " + status));
            return;
          }
          resolve(result);
        }
      );
    });
  }

  async function resolvePlacesForMap(places) {
    var resolved = [];
    var i;

    for (i = 0; i < places.length; i += 1) {
      var place = places[i];
      var query = buildPlaceGeocodeQuery(
        place,
        place.declaredCountry || "",
        place.declaredCity || ""
      );
      var countryCode = window.TravelLocationData
        ? window.TravelLocationData.getCountryCodeFromInput(place.declaredCountry || "")
        : "";
      var geo = await geocodePlace(query, countryCode);
      resolved.push({
        title: place.name,
        address: place.address,
        query: query,
        formattedAddress: geo.formattedAddress,
        lat: geo.lat,
        lng: geo.lng,
        latLng: geo.latLng,
        sourcePlace: place,
      });
    }
    return resolved;
  }

  async function resolveHotelForMap(lodging, fallbackCountry, fallbackCity) {
    if (!lodging || !lodging.hotel) {
      return null;
    }
    var hotel = lodging.hotel;
    var hotelName = String(hotel.name || "").trim();
    var hotelAddress = String(hotel.address || "").trim();
    if (!hotelName && !hotelAddress) {
      return null;
    }
    var query = window.TravelPlanner.buildGeocodeQuery(
      {
        name: hotelName || "酒店",
        addressExtra: hotelAddress,
      },
      fallbackCountry || "",
      fallbackCity || ""
    );
    var countryCode = window.TravelLocationData
      ? window.TravelLocationData.getCountryCodeFromInput(fallbackCountry || "")
      : "";
    var geo = await geocodePlace(query, countryCode);
    return {
      title: hotelName || "酒店",
      formattedAddress: geo.formattedAddress,
      latLng: geo.latLng,
    };
  }

  function placeHotelMarker(hotelInfo) {
    if (!hotelInfo) {
      return null;
    }
    var marker = new google.maps.Marker({
      map: state.map,
      position: hotelInfo.latLng,
      label: {
        text: "H",
        color: "#ffffff",
        fontWeight: "700",
      },
      title: "酒店 · " + hotelInfo.title + " - " + hotelInfo.formattedAddress,
    });
    state.routeMarkers.push(marker);
    return marker;
  }

  async function markOrderedPlacesOnMap() {
    if (!state.mapReady) {
      updateStatus("请先连接 Google 地图。", true);
      return;
    }

    var tripInput = collectAllTripInput();
    var destinations = tripInput.destinations;
    var places = tripInput.places;
    if (!destinations.length) {
      updateStatus("请至少填写一个国家和城市。", true);
      return;
    }
    if (!places.length) {
      updateStatus("请至少填写一个点位。", true);
      return;
    }

    state.places = places;
    renderPlacesList();
    updateStatus("正在地理编码并在地图上标点...", false);

    try {
      var resolvedStops = await resolvePlacesForMap(places);
      var primary = primaryDestination(destinations);
      var hotelStop = await resolveHotelForMap(tripInput.lodging, primary.country, primary.city);
      clearRouteOverlays();
      placeHotelMarker(hotelStop);

      resolvedStops.forEach(function (stop, index) {
        if (stop.sourcePlace) {
          stop.sourcePlace.resolvedAddress = stop.formattedAddress;
          stop.sourcePlace.resolvedLat = stop.lat;
          stop.sourcePlace.resolvedLng = stop.lng;
          stop.sourcePlace.location = { lat: stop.lat, lng: stop.lng };
          stop.sourcePlace.geocodeQuery = stop.query;
        }

        var marker = new google.maps.Marker({
          map: state.map,
          position: stop.latLng,
          label: String(index + 1),
        title:
          (stop.sourcePlace.declaredCity || "") +
          " · " +
          stop.title +
          " - " +
          stop.formattedAddress,
        });
        state.routeMarkers.push(marker);
      });

      state.places = places;
      renderPlacesList();

      if (resolvedStops.length === 1 && !hotelStop) {
        state.map.setCenter(resolvedStops[0].latLng);
        state.map.setZoom(14);
      } else {
        var bounds = new google.maps.LatLngBounds();
        if (hotelStop) {
          bounds.extend(hotelStop.latLng);
        }
        resolvedStops.forEach(function (stop) {
          bounds.extend(stop.latLng);
        });
        state.map.fitBounds(bounds);
      }

      updateStatus("已在地图上按顺序标点（共 " + resolvedStops.length + " 个）" + (hotelStop ? "，并标记酒店 H 点" : "") + "。", false);
      setLayoutMode("map");
    } catch (err) {
      updateStatus("地图标点失败: " + err.message, true);
    }
  }

  function findPlaceForStop(stopTitle) {
    var target = String(stopTitle || "").trim().toLowerCase();
    if (!target) {
      return null;
    }
    var list = Array.isArray(state.places) ? state.places : [];
    return list.find(function (place) {
      return String(place && place.name || "").trim().toLowerCase() === target;
    }) || null;
  }

  async function renderRouteOnMap(planData, country, city, lodgingSummary) {
    if (!state.mapReady) {
      updateStatus("请先连接 Google 地图。", true);
      return;
    }

    var routeStops = window.TravelPlanner.buildRouteStops(planData);
    if (!routeStops.length) {
      clearRouteOverlays();
      updateStatus("没有可展示的路线点。", true);
      return;
    }

    updateStatus("正在计算路线并渲染地图...", false);

    var resolvedStops = [];
    var i;
    for (i = 0; i < routeStops.length; i += 1) {
      var stop = routeStops[i];
      // 复用景点自身的 geocodeQuery（含景点名 + 该点所属城市/国家），与「在地图上标点」保持一致，
      // 避免退回到只有「城市, 国家」的展示地址而把同城景点全部解析到市中心导致重合。
      var matchedPlace = findPlaceForStop(stop.title);
      var query = (matchedPlace && matchedPlace.geocodeQuery)
        ? matchedPlace.geocodeQuery
        : (window.TravelPlanner.buildGeocodeQuery(
            {
              name: stop.title,
              addressExtra: "",
            },
            (matchedPlace && matchedPlace.declaredCountry) || country,
            (matchedPlace && matchedPlace.declaredCity) || city
          ));
      var countryCode = window.TravelLocationData
        ? window.TravelLocationData.getCountryCodeFromInput(
            (matchedPlace && matchedPlace.declaredCountry) || stop.country || country || ""
          )
        : "";
      var geo = await geocodePlace(query, countryCode);
      resolvedStops.push({
        title: stop.title,
        day: stop.day,
        startTime: stop.startTime,
        address: stop.address,
        formattedAddress: geo.formattedAddress,
        latLng: geo.latLng,
      });
    }

    clearRouteOverlays();
    if (lodgingSummary && (lodgingSummary.formattedAddress || lodgingSummary.hotelName)) {
      var hotelQuery = String(lodgingSummary.formattedAddress || lodgingSummary.hotelName || "");
      if (hotelQuery) {
        try {
          var hotelCountryCode = window.TravelLocationData
            ? window.TravelLocationData.getCountryCodeFromInput(country || "")
            : "";
          var hotelGeo = await geocodePlace(hotelQuery, hotelCountryCode);
          placeHotelMarker({
            title: lodgingSummary.hotelName || "酒店",
            formattedAddress: hotelGeo.formattedAddress,
            latLng: hotelGeo.latLng,
          });
        } catch (err) {
          // ignore hotel marker failure
        }
      }
    }

    resolvedStops.forEach(function (stop, index) {
      var marker = new google.maps.Marker({
        map: state.map,
        position: stop.latLng,
        label: String(index + 1),
        title: "Day " + stop.day + " " + stop.startTime + " " + stop.title,
      });
      state.routeMarkers.push(marker);
    });

    if (resolvedStops.length === 1) {
      state.map.setCenter(resolvedStops[0].latLng);
      state.map.setZoom(14);
      updateStatus("智能规划完成，已展示单点位置。", false);
      return;
    }

    var segments = splitStopsIntoRouteSegments(resolvedStops, 25);
    for (i = 0; i < segments.length; i += 1) {
      var directionsResult = await requestDirections(segments[i]);
      var renderer = new google.maps.DirectionsRenderer({
        map: state.map,
        suppressMarkers: true,
        preserveViewport: i > 0,
        polylineOptions: {
          strokeColor: "#2563eb",
          strokeOpacity: 0.85,
          strokeWeight: 5,
        },
      });
      renderer.setDirections(directionsResult);
      state.routeRenderers.push(renderer);
    }

    state.currentRouteStops = resolvedStops;
    state.routeMode = "driving";
    updateRouteModeButtons();
    showRouteModeToggle(true);

    var bounds = new google.maps.LatLngBounds();
    resolvedStops.forEach(function (stop) {
      bounds.extend(stop.latLng);
    });
    state.map.fitBounds(bounds);
    updateStatus("智能规划完成，路线已展示（可切换自驾/公交）。", false);
  }

  function renderPlacesList() {
    if (!state.places.length) {
      ui.placesList.innerHTML = "<p>暂无点位，请先填写点位列表。</p>";
      return;
    }

    ui.placesList.innerHTML = state.places.map(function (place, index) {
      var durationLabel = place.suggestedDurationMin || place.durationMin;
      var reasonLabel = place.llmReason || "";
      var durationLine = durationLabel ? ("建议停留: " + durationLabel + " 分钟") : "";
      var reasonLine = reasonLabel ? ("<br/>LLM建议: " + escapeHtml(reasonLabel)) : "";
      var queryLine = place.geocodeQuery
        ? ("<br/>查询: " + escapeHtml(place.geocodeQuery))
        : "";
      var locationLine = place.resolvedAddress
        ? ("<br/><strong>具体位置:</strong> " + escapeHtml(place.resolvedAddress))
        : "<br/><span class=\"place-pending\">具体位置: 点击「在地图上标点」后解析</span>";
      var coordLine = Number.isFinite(place.resolvedLat) && Number.isFinite(place.resolvedLng)
        ? ("<br/>坐标: " + place.resolvedLat.toFixed(6) + ", " + place.resolvedLng.toFixed(6))
        : "";

      return (
        "<div class=\"place-item\">" +
        "<span><strong>" + (index + 1) + ". " + escapeHtml(place.name) + "</strong>" +
        locationLine +
        coordLine +
        queryLine +
        (durationLine ? ("<br/>" + escapeHtml(durationLine)) : "") +
        reasonLine +
        "</span></div>"
      );
    }).join("");
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function factLineText(days, placeCount, metrics, strategyLabel) {
    var bits = [days + " 天", placeCount + " 个景点"];
    var m = metrics || {};
    if (Number.isFinite(Number(m.totalTravelMin))) {
      bits.push("总通勤约 " + Math.round(Number(m.totalTravelMin)) + " 分钟");
    }
    bits.push("跨城 " + (Number(m.crossCityCount) || 0) + " 次");
    bits.push("折返 " + (Number(m.backtrackCount) || 0) + " 次");
    if (strategyLabel) {
      bits.push("策略「" + strategyLabel + "」");
    }
    return bits.join(" · ");
  }

  function appendDailyPlansText(result, dailyPlans) {
    (Array.isArray(dailyPlans) ? dailyPlans : []).forEach(function (dayPlan) {
      result.push("Day " + dayPlan.day + (dayPlan.date ? (" · " + dayPlan.date) : ""));
      (Array.isArray(dayPlan.segments) ? dayPlan.segments : []).forEach(function (segment) {
        if (segment.type === "visit") {
          result.push("  - 游览 " + segment.placeName + (segment.visitTimeRange ? ("（" + segment.visitTimeRange + "）") : ""));
          if (segment.openingHours && segment.openingHours.open && segment.openingHours.close && segment.openingHours.verifyState !== "unverified") {
            result.push("      营业：" + segment.openingHours.open + "–" + segment.openingHours.close + "（来源 Google Places）");
          }
        } else {
          result.push("  - 交通 " + segment.from + " -> " + segment.to + (segment.durationRange ? ("（" + segment.durationRange + "）") : ""));
          if (Array.isArray(segment.legs) && segment.legs.length) {
            segment.legs.forEach(function (leg) {
              var label = leg.type === "walk" ? "步行" : (leg.line ? (leg.type + " " + leg.line) : leg.type);
              var route = (leg.from || leg.to) ? (" " + (leg.from || "") + " -> " + (leg.to || "")) : "";
              var dur = Number.isFinite(Number(leg.durationMin)) ? ("（约" + Math.round(Number(leg.durationMin)) + "分钟）") : "";
              result.push("      · " + label + route + dur);
            });
          }
        }
      });
    });
  }

  function buildRoadbookText(exportData) {
    var data = exportData || {};
    var result = [];
    result.push("智能路书导出");
    result.push("生成时间: " + new Date().toLocaleString());
    result.push("");
    result.push("推荐游览路书 · " + (data.city || "") + (data.country ? (", " + data.country) : ""));
    var dailyPlans = Array.isArray(data.dailyPlans) ? data.dailyPlans : [];
    var placeCount = Array.isArray(data.recommendedOrder) ? data.recommendedOrder.length : 0;
    result.push(factLineText(dailyPlans.length, placeCount, data.routeMetrics, data.strategyLabel));
    if (data.lodgingSummary && data.lodgingSummary.hotelName) {
      result.push("酒店: " + data.lodgingSummary.hotelName +
        (data.lodgingSummary.formattedAddress ? ("（" + data.lodgingSummary.formattedAddress + "）") : ""));
    }
    if (data.summary) {
      result.push(firstSentence(data.summary));
    }
    if (data.dayConflict && data.dayConflict.type && data.dayConflict.type !== "none" && data.dayConflict.message) {
      result.push("⚑ " + data.dayConflict.message);
    }
    result.push("");
    if (dailyPlans.length) {
      result.push("【按日行程" + (data.planLabel ? ("（" + data.planLabel + "）") : "") + "】");
      appendDailyPlansText(result, dailyPlans);
      result.push("");
    }
    if (data.alternativePlan && Array.isArray(data.alternativePlan.dailyPlans) && data.alternativePlan.dailyPlans.length) {
      var alt = data.alternativePlan;
      var altCount = Array.isArray(alt.recommendedOrder) ? alt.recommendedOrder.length : 0;
      result.push("【" + (alt.label || "备选方案") + "】");
      result.push(factLineText(alt.days, altCount, alt.routeMetrics, data.strategyLabel));
      appendDailyPlansText(result, alt.dailyPlans);
      result.push("");
    }
    if (data.validation && data.validation.timeFeasibility) {
      var tf = data.validation.timeFeasibility;
      result.push("【行程校验】");
      result.push("可行性: " + (tf.feasible ? "可行" : "可能超载"));
      if (tf.reason) {
        result.push("原因: " + tf.reason);
      }
      if (Number.isFinite(tf.suggestedDays)) {
        result.push("建议天数: " + tf.suggestedDays);
      }
      result.push("");
    }
    var precautions = Array.isArray(data.precautions) ? data.precautions : [];
    if (precautions.length) {
      result.push("【注意事项】");
      precautions.forEach(function (item) {
        result.push("  - " + item);
      });
      result.push("");
    }
    return result.join("\n");
  }

  function downloadRoadbookText() {
    if (!state.lastRoadbookExport) {
      updateStatus("暂无可导出的路书，请先生成智能路书。", true);
      return;
    }
    var text = buildRoadbookText(state.lastRoadbookExport);
    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    var dateText = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = "智能路书-" + dateText + ".txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    updateStatus("已导出 TXT 路书。", false);
  }

  function firstSentence(text) {
    var s = String(text || "").trim();
    if (!s) {
      return "";
    }
    var m = s.split(/(?<=[。！？.!?])\s*/)[0];
    var out = m && m.length ? m : s;
    if (out.length > 60) {
      out = out.slice(0, 60) + "…";
    }
    return out;
  }

  function buildFactLine(days, placeCount, metrics, strategyLabel) {
    var bits = [];
    bits.push(days + " 天");
    bits.push(placeCount + " 个景点");
    var m = metrics || {};
    if (Number.isFinite(Number(m.totalTravelMin))) {
      bits.push("总通勤约 " + Math.round(Number(m.totalTravelMin)) + " 分钟");
    }
    bits.push("跨城 " + (Number(m.crossCityCount) || 0) + " 次");
    bits.push("折返 " + (Number(m.backtrackCount) || 0) + " 次");
    if (strategyLabel) {
      bits.push("策略「" + strategyLabel + "」");
    }
    return bits.join(" · ");
  }

  // v1.5.2 #1：营业时间展示（自证使用了 Google Places API）。已核实显示"营业 HH:MM–HH:MM · 来源 Google Places"，
  // 未核实/未获取显示灰字提示；无数据（工具关闭/未查该点）则不渲染任何内容。
  function renderOpeningHours(oh) {
    if (!oh) {
      return "";
    }
    if (oh.open && oh.close && oh.verifyState !== "unverified") {
      return "<p class=\"station-meta station-hours\">营业：" + escapeHtml(oh.open + "–" + oh.close) +
        " · 来源 Google Places</p>";
    }
    return "<p class=\"station-meta station-hours station-hours-missing\">营业时间：未获取（未核实）</p>";
  }

  function renderTransitConnector(segment) {
    var transitDetail = "";
    if (Array.isArray(segment.legs) && segment.legs.length) {
      var legsHtml = segment.legs.map(function (leg) {
        var label = leg.type === "walk" ? "步行" : (leg.line ? (leg.type + " " + leg.line) : leg.type);
        var route = (leg.from || leg.to) ? (escapeHtml(leg.from || "") + " → " + escapeHtml(leg.to || "")) : "";
        return "<li>" + escapeHtml(label) +
          (route ? ("：" + route) : "") +
          (Number.isFinite(Number(leg.durationMin)) ? ("（约" + Math.round(Number(leg.durationMin)) + "分钟）") : "") +
          "</li>";
      }).join("");
      transitDetail = "<details class=\"transit-detail\"><summary>公共交通分段</summary><ul>" + legsHtml + "</ul></details>";
    }
    return "<div class=\"station-transit\">↳ " + escapeHtml(segment.from) + " 前往 " + escapeHtml(segment.to) +
      (segment.durationRange ? ("（" + escapeHtml(segment.durationRange) + "）") : "") +
      transitDetail +
      "</div>";
  }

  function renderDayCards(dailyPlans) {
    return (Array.isArray(dailyPlans) ? dailyPlans : []).map(function (dayPlan) {
      var stationNo = 0;
      var body = (Array.isArray(dayPlan.segments) ? dayPlan.segments : []).map(function (segment) {
        if (segment.type === "visit") {
          stationNo += 1;
          return "<article class=\"station-card\">" +
            "<h5>第 " + stationNo + " 站 · " + escapeHtml(segment.placeName) + "</h5>" +
            (segment.visitTimeRange ? ("<p class=\"station-meta\">游玩：" + escapeHtml(segment.visitTimeRange) + "</p>") : "") +
            renderOpeningHours(segment.openingHours) +
            "</article>";
        }
        return renderTransitConnector(segment);
      }).join("");
      return "<div class=\"day-block\">" +
        "<h4>Day " + dayPlan.day + (dayPlan.date ? (" · " + escapeHtml(dayPlan.date)) : "") + "</h4>" +
        body +
        "</div>";
    }).join("");
  }

  function renderAgentRoadbook(agentResult, country, city) {
    if (!agentResult) {
      ui.itineraryResult.innerHTML = "<p>无路书内容，请检查 LLM 配置后重试。</p>";
      return;
    }

    var sections = [];

    // 概览头：数据驱动的事实条 + 一句受约束点评 + 天数冲突提示（路线策略/住宿摘要已并入此处）
    var overviewMetrics = agentResult.routeMetrics || {};
    var overviewDays = (Array.isArray(agentResult.dailyPlans) ? agentResult.dailyPlans : []).length;
    var overviewPlaceCount = (Array.isArray(agentResult.recommendedOrder) ? agentResult.recommendedOrder : []).length;
    var lodging = agentResult.lodgingSummary || {};
    var hotelLine = lodging.hotelName
      ? ("<p class=\"overview-hotel\"><strong>酒店：</strong>" + escapeHtml(lodging.hotelName) +
          (lodging.formattedAddress ? ("（" + escapeHtml(lodging.formattedAddress) + "）") : "") + "</p>")
      : "";
    var summaryLine = agentResult.summary
      ? ("<p class=\"overview-summary\">" + escapeHtml(firstSentence(agentResult.summary)) + "</p>")
      : "";
    var conflict = agentResult.dayConflict || {};
    var conflictLine = (conflict.type && conflict.type !== "none" && conflict.message)
      ? ("<p class=\"overview-conflict\">⚑ " + escapeHtml(conflict.message) + "</p>")
      : "";
    sections.push(
      "<section class=\"roadbook-section roadbook-overview\">" +
      "<h3>推荐游览路书 · " + escapeHtml(city) + ", " + escapeHtml(country) + "</h3>" +
      "<p class=\"overview-facts\">" + escapeHtml(buildFactLine(overviewDays, overviewPlaceCount, overviewMetrics, agentResult.strategyLabel)) + "</p>" +
      hotelLine +
      summaryLine +
      conflictLine +
      "</section>"
    );

    // v1.4 策略对比（A/B）：用户所选策略 vs 次优策略，仅在存在有差异的次优方案时展示。
    var comparison = agentResult.strategyComparison;
    if (comparison && comparison.runnerUp) {
      var explain = agentResult.strategyExplanation || {};
      var reasonLine = explain.reason
        ? ("<p class=\"overview-summary\">" + escapeHtml(explain.reason) + "</p>")
        : "";
      sections.push(
        "<section class=\"roadbook-section roadbook-strategy-compare\">" +
        "<h3>策略对比</h3>" +
        "<p><strong>当前采用：</strong>「" + escapeHtml(comparison.primary.strategyLabel || comparison.primary.strategy) + "」</p>" +
        reasonLine +
        "<p><strong>另可选择：</strong>「" + escapeHtml(comparison.runnerUp.strategyLabel || comparison.runnerUp.strategy) + "」——" +
        escapeHtml(comparison.runnerUp.tradeoff || comparison.runnerUp.description || "") + "</p>" +
        "</section>"
      );
    }

    var spotlights = Array.isArray(agentResult.placeSpotlights) ? agentResult.placeSpotlights : [];
    if (spotlights.length) {
      var spotlightHtml = spotlights.map(function (item, index) {
        var tipsLine = item.tips
          ? ("<p class=\"roadbook-meta\"><strong>小贴士：</strong>" + escapeHtml(item.tips) + "</p>")
          : "";
        return (
          "<article class=\"spotlight-card\">" +
          "<h4>" + (index + 1) + ". " + escapeHtml(item.name) + "</h4>" +
          "<p>" + escapeHtml(item.introduction || "暂无介绍") + "</p>" +
          (item.highlights ? ("<p class=\"roadbook-meta\"><strong>看点：</strong>" + escapeHtml(item.highlights) + "</p>") : "") +
          (item.suggestedVisitRange ? ("<p class=\"roadbook-meta\"><strong>建议停留：</strong>" + escapeHtml(item.suggestedVisitRange) + "</p>") : "") +
          tipsLine +
          "</article>"
        );
      }).join("");
      sections.push(
        "<section class=\"roadbook-section\">" +
        "<h3>景点速览</h3>" +
        spotlightHtml +
        "</section>"
      );
    }

    // ⑤原「推荐游览路书」(LLM 自由步骤) 与 ⑥「按日行程」合并：只用权威 dailyPlans，套用车站卡片排版
    var dailyPlans = Array.isArray(agentResult.dailyPlans) ? agentResult.dailyPlans : [];
    if (dailyPlans.length) {
      var primaryLabel = agentResult.planLabel ? (" · " + escapeHtml(agentResult.planLabel)) : "";
      sections.push(
        "<section class=\"roadbook-section\">" +
        "<h3>按日行程（酒店闭环）" + primaryLabel + "</h3>" +
        renderDayCards(dailyPlans) +
        "</section>"
      );
    }

    // gap==1 的第二方案：上下堆叠、同时展开
    var altPlan = agentResult.alternativePlan;
    if (altPlan && Array.isArray(altPlan.dailyPlans) && altPlan.dailyPlans.length) {
      var altPlaceCount = (Array.isArray(altPlan.recommendedOrder) ? altPlan.recommendedOrder : []).length;
      sections.push(
        "<section class=\"roadbook-section roadbook-alt\">" +
        "<h3>" + escapeHtml(altPlan.label || "备选方案") + "</h3>" +
        "<p class=\"overview-facts\">" + escapeHtml(buildFactLine(altPlan.days, altPlaceCount, altPlan.routeMetrics, agentResult.strategyLabel)) + "</p>" +
        renderDayCards(altPlan.dailyPlans) +
        "</section>"
      );
    }

    if (agentResult.validation) {
      var validation = agentResult.validation;
      var warnings = Array.isArray(validation.warnings) ? validation.warnings : [];
      var lodgingWarnings = Array.isArray(validation.lodgingWarnings) ? validation.lodgingWarnings : [];
      var excluded = Array.isArray(validation.excludedPlaces) ? validation.excludedPlaces : [];
      var timeInfo = validation.timeFeasibility || {};
      // v1.5 新增风险校验（闭馆/体力/回酒店往返）：从 findings 过滤展示，未核实项显式标注。
      var v15Codes = { OPENING_RISK: "闭馆风险", PHYSICAL_OVERLOAD: "体力强度", HOTEL_RETURN_COST: "回酒店往返" };
      var v15Findings = (Array.isArray(validation.findings) ? validation.findings : []).filter(function (f) {
        return f && v15Codes[f.code];
      });
      var riskHtml = v15Findings.length
        ? ("<p><strong>风险校验（v1.5）：</strong></p><ul>" + v15Findings.map(function (f) {
            var tag = v15Codes[f.code] + (f.level === "error" ? "·必看" : "·提醒");
            var unverified = f.evidence && f.evidence.verifyState === "unverified" ? "（未核实）" : "";
            return "<li>[" + escapeHtml(tag) + "] " + escapeHtml(f.message || "") + escapeHtml(unverified) + "</li>";
          }).join("") + "</ul>")
        : "";
      sections.push(
        "<section class=\"roadbook-section\">" +
        "<h3>行程校验</h3>" +
        "<p><strong>时间可行性：</strong>" +
        (timeInfo.feasible ? "可行" : "可能超载") +
        (timeInfo.reason ? (" - " + escapeHtml(timeInfo.reason)) : "") +
        "</p>" +
        (excluded.length
          ? ("<p><strong>已排除景点：</strong></p><ul>" + excluded.map(function (item) {
              return "<li>" + escapeHtml(item.name) + "：" + escapeHtml(item.reason || "归属不匹配") + "</li>";
            }).join("") + "</ul>")
          : "") +
        (lodgingWarnings.length
          ? ("<p><strong>酒店相关提醒：</strong></p><ul>" + lodgingWarnings.map(function (item) {
              return "<li>" + escapeHtml(item) + "</li>";
            }).join("") + "</ul>")
          : "") +
        (warnings.length
          ? ("<p><strong>待核实提醒：</strong></p><ul>" + warnings.map(function (item) {
              return "<li>" + escapeHtml(item) + "</li>";
            }).join("") + "</ul>")
          : "") +
        riskHtml +
        "</section>"
      );
    }

    // 旧「替代方案」噪音区块已移除；唯一的多方案是 gap==1 的第二方案（上方堆叠展示）

    var precautions = Array.isArray(agentResult.precautions) ? agentResult.precautions : [];
    if (precautions.length) {
      sections.push(
        "<section class=\"roadbook-section roadbook-precautions\">" +
        "<details><summary>注意事项（" + precautions.length + "）</summary>" +
        "<ul>" +
        precautions.map(function (item) {
          return "<li>" + escapeHtml(item) + "</li>";
        }).join("") +
        "</ul>" +
        "</details>" +
        "</section>"
      );
    }

    if (!sections.length) {
      ui.itineraryResult.innerHTML = "<p>模型未返回有效路书，请重试或检查 API 配置。</p>";
      ui.downloadRoadbookBtn.classList.add("hidden");
      state.lastRoadbookExport = null;
      return;
    }

    ui.itineraryResult.innerHTML = sections.join("");
    state.lastRoadbookExport = {
      country: country,
      city: city,
      summary: agentResult.summary || "",
      strategyLabel: agentResult.strategyLabel || "",
      routeMetrics: agentResult.routeMetrics || null,
      recommendedOrder: Array.isArray(agentResult.recommendedOrder) ? agentResult.recommendedOrder : [],
      lodgingSummary: agentResult.lodgingSummary || null,
      dailyPlans: Array.isArray(agentResult.dailyPlans) ? agentResult.dailyPlans : [],
      validation: agentResult.validation || null,
      precautions: Array.isArray(agentResult.precautions) ? agentResult.precautions : [],
      planLabel: agentResult.planLabel || "",
      dayConflict: agentResult.dayConflict || null,
      alternativePlan: agentResult.alternativePlan || null,
    };
    ui.downloadRoadbookBtn.classList.remove("hidden");
  }

  function resetItineraryPanel() {
    ui.itineraryResult.innerHTML = ITINERARY_PLACEHOLDER;
    ui.downloadRoadbookBtn.classList.add("hidden");
    state.lastRoadbookExport = null;
  }

  function mergePlacesWithLlmInsights(places) {
    var llmModule = window.TravelLlm;
    if (!llmModule || typeof llmModule.normalizeName !== "function") {
      return places;
    }
    return places.map(function (place) {
      var normalizedName = llmModule.normalizeName(place.name);
      var insight = state.llmInsights[normalizedName];
      if (!insight) {
        return place;
      }

      var nextPlace = Object.assign({}, place);
      if (!nextPlace.durationMin) {
        nextPlace.suggestedDurationMin = insight.suggestedDurationMin;
      }
      if (Number.isFinite(insight.score)) {
        nextPlace.score = insight.score;
      }
      nextPlace.llmReason = insight.reason;
      nextPlace.llmPriority = insight.priority;
      return nextPlace;
    });
  }

  async function analyzePlacesWithLlm() {
    if (!window.TravelLlm) {
      updateStatus("LLM 模块未加载，请刷新页面。", true);
      return;
    }

    var tripInput = collectAllTripInput();
    var country = tripInput.country;
    var city = tripInput.city;
    var totalDays = Number(tripInput.totalDays);
    var rawPlaces = tripInput.places;
    var baseUrl = ui.llmBaseUrlInput.value.trim();
    var apiKey = ui.llmApiKeyInput.value.trim();
    var model = pickLlmModelValue();

    if (!country || !city) {
      updateStatus("请至少填写一个国家和城市（取首个城市做分析锚点）。", true);
      return;
    }
    if (!rawPlaces.length) {
      updateStatus("请先填写点位后再做 LLM 分析。", true);
      return;
    }
    if (!baseUrl || !apiKey || !model) {
      updateStatus("请填写 LLM Base URL、API Key 和 Model。", true);
      return;
    }

    updateStatus("正在调用 LLM 分析景点时长与优先级...", false);
    try {
      var prompt = window.TravelLlm.buildPlaceAnalysisPrompt({
        country: country,
        city: city,
        totalDays: totalDays,
        places: rawPlaces,
      });

      var response = await fetch(baseUrl.replace(/\/$/, "") + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model: model,
          temperature: 0.2,
          messages: [
            { role: "system", content: "你是专业旅行规划助手。" },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (!response.ok) {
        var errText = await response.text();
        throw new Error("LLM 请求失败(" + response.status + "): " + errText);
      }

      var data = await response.json();
      var content = (((data || {}).choices || [])[0] || {}).message;
      var answerText = content ? content.content : "";
      if (Array.isArray(answerText)) {
        answerText = answerText.map(function (part) {
          if (typeof part === "string") {
            return part;
          }
          return part && part.text ? part.text : "";
        }).join("\n");
      }
      if (!answerText) {
        throw new Error("LLM 返回内容为空");
      }

      var analysis = window.TravelLlm.parseAnalysisJson(answerText);
      state.llmInsights = window.TravelLlm.toInsightMap(analysis.places);
      state.places = mergePlacesWithLlmInsights(rawPlaces);
      renderPlacesList();
      updateStatus("LLM 分析完成，可继续点击 Agent 智能规划。", false);
    } catch (err) {
      updateStatus("LLM 分析失败: " + err.message, true);
    }
  }

  async function agentPlanWithTools() {
    var tripInput = collectAllTripInput();
    var country = tripInput.country;
    var city = tripInput.city;
    var totalDays = tripInput.totalDays;
    var visitMinutes = tripInput.visitMinutes;
    var strategy = tripInput.strategy;
    var transportPreference = tripInput.transportPreference;
    var physicalPreference = tripInput.physicalPreference;
    var places = tripInput.places;
    var mapsApiKey = ui.apiKeyInput.value.trim();
    var llmBaseUrl = ui.llmBaseUrlInput.value.trim();
    var llmApiKey = ui.llmApiKeyInput.value.trim();
    var llmModel = pickLlmModelValue();

    if (!tripInput.destinations.length) {
      updateStatus("请先填写目的地层级（国家/城市/点位）。", true);
      return;
    }
    if (!Number.isFinite(totalDays) || totalDays <= 0) {
      updateStatus("游玩天数必须是正整数。", true);
      return;
    }
    if (!places.length) {
      updateStatus("请先填写点位列表。", true);
      return;
    }
    if (!mapsApiKey) {
      updateStatus("Agent 工具调用需要 Google Maps API Key。", true);
      return;
    }
    if (!llmBaseUrl || !llmApiKey || !llmModel) {
      updateStatus("Agent 规划需要完整 LLM 配置。", true);
      return;
    }

    updateStatus("正在进行 Agent 智能规划（LLM + Google Maps工具）...", false);
    setLayoutMode("roadbook");
    setPlanningLoading(true);
    setPlanProgressVisible(true);
    updatePlanProgress(3, "准备请求...");
    try {
      var response = await fetch("/api/agent/plan/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          country: country,
          city: city,
          totalDays: totalDays,
          visitMinutes: visitMinutes,
          strategy: strategy,
          transportPreference: transportPreference,
          physicalPreference: physicalPreference,
          places: places,
          destinations: tripInput.destinations,
          lodging: tripInput.lodging,
          llmBaseUrl: llmBaseUrl,
          llmApiKey: llmApiKey,
          llmModel: llmModel,
          mapsApiKey: mapsApiKey,
        }),
      });

      if (!response.ok) {
        var errText = await response.text();
        throw new Error("Agent 规划失败(" + response.status + "): " + errText);
      }

      if (!response.body) {
        throw new Error("浏览器不支持流式响应，请刷新后重试");
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      var data = null;

      while (true) {
        var chunkResult = await reader.read();
        if (chunkResult.done) {
          break;
        }
        buffer += decoder.decode(chunkResult.value, { stream: true });
        var lines = buffer.split("\n");
        buffer = lines.pop() || "";
        lines.forEach(function (line) {
          var text = line.trim();
          if (!text) {
            return;
          }
          var msg;
          try {
            msg = JSON.parse(text);
          } catch (err) {
            return;
          }
          if (msg.type === "progress") {
            var stage = msg.message || msg.stage || "处理中...";
            var percent = Number(msg.percent);
            if (!Number.isFinite(percent)) {
              percent = 10;
            }
            updatePlanProgress(percent, stage);
            updateStatus(stage, false);
            return;
          }
          if (msg.type === "error") {
            throw new Error(msg.error || "规划失败");
          }
          if (msg.type === "result") {
            data = msg.data || null;
          }
        });
      }

      if (!data) {
        throw new Error("未收到有效规划结果");
      }

      updatePlanProgress(100, "路书生成完成");
      var planData = Array.isArray(data.planData) ? data.planData : [];
      state.places = Array.isArray(data.enrichedPlaces) ? data.enrichedPlaces : places;
      renderPlacesList();
      renderAgentRoadbook(data, country, city);
      if (state.mapReady) {
        await renderRouteOnMap(planData, country, city, data.lodgingSummary || null);
        updateStatus("智能路书已生成，地图路线已按推荐顺序展示。", false);
      } else {
        updateStatus("智能路书已生成；连接地图后可展示推荐路线。", false);
      }
      setLayoutMode("roadbook");
    } catch (err) {
      updateStatus("Agent 智能规划失败: " + err.message, true);
    } finally {
      setPlanningLoading(false);
      setTimeout(function () {
        setPlanProgressVisible(false);
      }, 1200);
    }
  }

  function connectGoogleMap() {
    var apiKey = ui.apiKeyInput.value.trim();
    if (!apiKey) {
      updateStatus("请先输入 Google Maps API Key。", true);
      return;
    }
    if (state.mapReady) {
      updateStatus("地图已连接。", false);
      return;
    }
    if (state.mapLoading) {
      updateStatus("地图正在连接，请稍候。", false);
      return;
    }

    state.mapLoading = true;
    window.__travelMapInit = function () {
      state.map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 48.8566, lng: 2.3522 },
        zoom: 12,
      });
      state.geocoder = new google.maps.Geocoder();
      state.directionsService = new google.maps.DirectionsService();
      state.mapReady = true;
      state.mapLoading = false;
      updateStatus("Google 地图连接成功，可点击「在地图上标点」。", false);
    };

    var script = document.createElement("script");
    script.src = "https://maps.googleapis.com/maps/api/js?key=" +
      encodeURIComponent(apiKey) +
      "&callback=__travelMapInit";
    script.async = true;
    script.defer = true;
    script.onerror = function () {
      state.mapLoading = false;
      updateStatus("Google 地图加载失败，请检查 API Key 和网络。", true);
    };
    document.head.appendChild(script);
    updateStatus("正在连接 Google 地图...", false);
  }

  function refreshPlacesPreview() {
    var places = collectAllTripInput().places;
    if (!places.length) {
      state.places = [];
      ui.placesList.innerHTML = "<p>暂无点位，请先填写点位列表。</p>";
      return;
    }
    state.places = places;
    renderPlacesList();
  }

  function attachEventHandlers() {
    ui.connectMapBtn.addEventListener("click", connectGoogleMap);
    ui.addCountryBtn.addEventListener("click", function () {
      addCountry("");
    });
    ui.markMapBtn.addEventListener("click", function () {
      markOrderedPlacesOnMap();
    });
    ui.downloadRoadbookBtn.addEventListener("click", function () {
      downloadRoadbookText();
    });
    ui.llmBaseUrlInput.addEventListener("change", refreshProviderAndModelByBaseUrl);
    ui.llmAnalyzeBtn.addEventListener("click", function () {
      analyzePlacesWithLlm();
    });
    ui.agentPlanBtn.addEventListener("click", function () {
      agentPlanWithTools();
    });
    ui.destinationsRoot.addEventListener("click", function (event) {
      var target = event.target;
      if (target.classList.contains("btn-add-city")) {
        var countryBlock = target.closest(".destination-country");
        addCityToCountry(countryBlock, "");
        refreshPlacesPreview();
        return;
      }
      if (target.classList.contains("btn-remove-country")) {
        var country = target.closest(".destination-country");
        if (!country) {
          return;
        }
        if (ui.destinationsRoot.querySelectorAll(".destination-country").length <= 1) {
          updateStatus("至少保留一个国家块。", false);
          return;
        }
        country.remove();
        refreshPlacesPreview();
        return;
      }
      if (target.classList.contains("btn-add-place")) {
        var cityBlock = target.closest(".destination-city");
        addPlaceRowToCity(cityBlock, "", "", false);
        refreshPlacesPreview();
        return;
      }
      if (target.classList.contains("btn-remove-city")) {
        var city = target.closest(".destination-city");
        var countryBlock = target.closest(".destination-country");
        if (!city || !countryBlock) {
          return;
        }
        if (countryBlock.querySelectorAll(".destination-city").length <= 1) {
          updateStatus("每个国家至少保留一个城市块。", false);
          return;
        }
        city.remove();
        refreshPlacesPreview();
        return;
      }
      if (target.classList.contains("btn-remove-place")) {
        var row = target.closest(".place-row");
        var cityContainer = target.closest(".destination-city");
        if (!row || !cityContainer) {
          return;
        }
        if (cityContainer.querySelectorAll(".place-row").length <= 1) {
          row.querySelector(".place-name-input").value = "";
          row.querySelector(".place-address-input").value = "";
          updateStatus("每个城市至少保留一行点位。", false);
          refreshPlacesPreview();
          return;
        }
        row.remove();
        refreshPlaceIndexesWithinCity(cityContainer);
        refreshPlacesPreview();
      }
    });
    ui.destinationsRoot.addEventListener("input", refreshPlacesPreview);
    ui.destinationsRoot.addEventListener("focusin", function () {
      setLayoutMode("input");
    });
    ui.llmBaseUrlInput.addEventListener("focus", function () {
      setLayoutMode("input");
    });
    ui.llmApiKeyInput.addEventListener("focus", function () {
      setLayoutMode("input");
    });
    ui.daysInput.addEventListener("focus", function () {
      setLayoutMode("input");
    });
    ui.visitMinutesInput.addEventListener("focus", function () {
      setLayoutMode("input");
    });
    if (ui.routeModeDrivingBtn) {
      ui.routeModeDrivingBtn.addEventListener("click", function () {
        setRouteMode("driving");
      });
    }
    if (ui.routeModeTransitBtn) {
      ui.routeModeTransitBtn.addEventListener("click", function () {
        setRouteMode("transit");
      });
    }
  }

  function applyPublicConfig(config) {
    if (!config || typeof config !== "object") {
      return;
    }
    // 仅在输入框为空时预填，保证用户仍可手动覆盖（正式上线时后端不下发密钥，用户自行填写）
    if (config.llmBaseUrl && !ui.llmBaseUrlInput.value.trim()) {
      ui.llmBaseUrlInput.value = config.llmBaseUrl;
    }
    if (config.llmApiKey && !ui.llmApiKeyInput.value.trim()) {
      ui.llmApiKeyInput.value = config.llmApiKey;
    }
    if (config.mapsApiKey && !ui.apiKeyInput.value.trim()) {
      ui.apiKeyInput.value = config.mapsApiKey;
    }
    refreshProviderAndModelByBaseUrl();
    if (config.llmModel) {
      var hasOption = Array.prototype.some.call(ui.llmModelSelect.options, function (opt) {
        return opt.value === config.llmModel;
      });
      if (hasOption) {
        ui.llmModelSelect.value = config.llmModel;
      }
    }
    if (config.exposeKeys) {
      updateStatus("已从后端预填密钥（自测模式）。正式上线请由用户自行填写。", false);
    }
  }

  function loadPublicConfig() {
    if (typeof fetch !== "function") {
      return;
    }
    fetch("/api/public-config")
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (config) {
        applyPublicConfig(config);
      })
      .catch(function () {
        // 拉取失败不影响手动填写，忽略
      });
  }

  function initDestinations() {
    addCountry("");
    refreshPlacesPreview();
  }

  initDestinations();
  resetItineraryPanel();
  refreshPlacesPreview();
  setLayoutMode("input");
  refreshProviderAndModelByBaseUrl();
  attachEventHandlers();
  loadPublicConfig();
}());
